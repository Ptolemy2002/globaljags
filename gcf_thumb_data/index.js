const {Storage} = require("@google-cloud/storage");
const {Firestore} = require("@google-cloud/firestore");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const sharp = require("sharp");
const getExif = require("exif-async");
const parseDMS = require("parse-dms");

module.exports.entry = async function(file, context) {
    const storage = new Storage();
    const srcBucket = storage.bucket(file.bucket);
    const thumbBucket = storage.bucket("sp24-41200-pbhenson-gj-thumbnails");
    const finalBucket = storage.bucket("sp24-41200-pbhenson-gj-final");

    const firestore = new Firestore({
        projectId: "sp24-41200-pbhenson-globaljags"
    });

    reportVersion();

    let fileExtension;
    try {
        // If the file is not valid, an error will be thrown, triggering a jump to the catch block.
        fileExtension = getImageType(file.contentType);
    } catch(e) {
        console.log("Error reading file!")
        console.error(e);
        return;
    }

    const finalName = `${file.generation}.${fileExtension}`;
    
    const workingDir = await ensureTempDir("thumbs");
    const tempFilePath = path.join(workingDir, finalName);
    await srcBucket.file(file.name).download({
        destination: tempFilePath
    });

    console.log("Temp File Path: " + tempFilePath);

    try {
        // Upload our local version of the file to the final images bucket
        await finalBucket.upload(tempFilePath);

        const thumbPath = await writeThumbnail(tempFilePath, path.join(workingDir, `thumb@64_${finalName}`));
        await thumbBucket.upload(thumbPath);
    } catch(e) {
        console.log("Error uploading final image or thumbnail!");
        console.error(e);
    }

    // get coordinates
    let gpsData;
    try {
        gpsData = getGPSCoordinates(await readExifData(tempFilePath));
    } catch(e) {
        console.log("Error reading GPS Data!");
        console.error(e);
        return;
    } 
    // Finally will always run after the try or catch block, even if the function returns.
    finally {
        // Delete the temp working directory and its files from the GCF's VM
        await fs.remove(workingDir);

        // DELETE the original file uploaded to the "Uploads" bucket
        await srcBucket.file(file.name).delete();
        console.log(`Deleted the uploaded file: ${file.name}`);
    }

    // write detail to FireStore
    try {
        const firestoreObj = {
            lat: gpsData.lat,
            lon: gpsData.lon,
            thumbURL: thumbBucket.file(`thumb@64_${finalName}`).publicUrl(),
            finalURL: finalBucket.file(finalName).publicUrl()
        };
        const collectionRef = firestore.collection("images");
        const documentRef = await collectionRef.add(firestoreObj);

        console.log("Created Firestore Document: " + documentRef.id);
    } catch(e) {
        console.log("Error Adding Firestore Document!");
        console.error(e);
        return;
    }
    
}

function reportVersion() {
    console.log(`Running version ${process.env.K_REVISION}`);
}

const imageTypeMap = {
    "image/jpeg": "jpg",
    "image/png": "png"
}

function getImageType(contentType) {
    if (imageTypeMap.hasOwnProperty(contentType)) {
        return imageTypeMap[contentType];
    } else {
        throw new Error(`Unsupported Content Type: ${contentType}`);
    }
}

async function ensureTempDir(p) {
    const workingDir = path.join(os.tmpdir(), p);
    // Wait for the directory to be ready
    await fs.ensureDir(workingDir);
    return workingDir;
}

async function writeThumbnail(filePath, thumbPath) {
    // Create the thumbnail and upload it
    await sharp(filePath).resize(64).withMetadata().toFile(thumbPath);
    return thumbPath;
}

function getGPSCoordinates({
    GPSLatitude: [latDeg, latMin, latSec],
    GPSLatitudeRef: latDir,
    GPSLongitude: [lngDeg, lngMin, lngSec],
    GPSLongitudeRef: lngDir
}) {
    //Format: DEG:MIN:SEC{DIR}
    function genString(deg, min, sec, dir) {
        return `${deg}:${min}:${sec}${dir}`
    }

    return parseDMS(`${genString(latDeg, latMin, latSec, latDir)} ${genString(lngDeg, lngMin, lngSec, lngDir)}`)
}

async function readExifData(localFile) {
    let exifData;

    try {
        exifData = await getExif(localFile);
        return exifData.gps;
    } catch(e) {
        console.error(e);
        return null;
    }
}