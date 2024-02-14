// Imports
const {Storage} = require("@google-cloud/storage");
const path = require("path");
const fs = require("fs-extra");
const os = require("os");
const sharp = require("sharp");

// Entry point function
exports.generateThumbnail = async (file, context) => {
  const gcsFile = file;
  const storage = new Storage();
  const sourceBucket = storage.bucket(gcsFile.bucket);
  const thumbnailsBucket = storage.bucket("sp24-41200-pbhenson-gj-thumbnails");
  const finalBucket = storage.bucket("sp24-41200-pbhenson-gj-final");

  const version = process.env.K_REVISION;
  console.log(`Running version ${version}`);

  console.log(`File Name: ${gcsFile.name}`);
  console.log(`Generation number: ${gcsFile.generation}`);
  console.log(`Content type: ${gcsFile.contentType}`);

  let fileExtension;
  let validFile = false;

  // Reject images that are not jpeg or png files
  if (gcsFile.contentType === "image/jpeg") {
    console.log("This is a JPG file.");
    fileExtension = "jpg";
    validFile = true;
  } else if (gcsFile.contentType === "image/png") {
    console.log("This is a PNG file.");
    fileExtension = "png";
    validFile = true;
  } else {

  }

  // If the file is a valid photograph, download it to the 'local' VM so that we can create a thumbnail image
  if (validFile) {
    // Create a new filename for the 'final' version of the image file
    // The value of this will be something like '12745649237578595.jpg'
    const finalFileName = `${gcsFile.generation}.${fileExtension}`;

    // Create a working directory on the VM that runs our GCF to download the original file
    // The value of this variable will be something like 'tmp/thumbs'
    const workingDir = path.join(os.tmpdir(), "thumbs");

    // Create a variable that holds the path to the 'local' version of the file
    // The value of this will be something like 'tmp/thumbs/398575858493.png'
    const tempFilePath = path.join(workingDir, finalFileName);

    // Wait until the working directory is ready
    await fs.ensureDir(workingDir);

    // Download the original file to the path on the 'local' VM
    await sourceBucket.file(gcsFile.name).download({
      destination: tempFilePath
    });

    // Upload our local version of the file to the final images bucket
    await finalBucket.upload(tempFilePath);

    // Create a name for the thumbnail image
    // The value for this will be something like `thumb@64_1234567891234567.jpg`
    const thumbName = `thumb@64_${finalFileName}`;

    // Create a path where we will store the thumbnail image locally
    // This will be something like `tmp/thumbs/thumb@64_1234567891234567.jpg`
    const thumbPath = path.join(workingDir, thumbName);

    // Use the sharp library to generate the thumbnail image and save it to the thumbPath
    // Then upload the thumbnail to the thumbnailsBucket in cloud storage
    await sharp(tempFilePath).resize(64).withMetadata().toFile(thumbPath).then(async () => {
      await thumbnailsBucket.upload(thumbPath);
    });

    // Delete the temp working directory and its files from the GCF's VM
    await fs.remove(workingDir);
  } // end of validFile==true

  // DELETE the original file uploaded to the "Uploads" bucket
  await sourceBucket.file(gcsFile.name).delete();
  console.log(`Deleted the uploaded file: ${gcsFile.name}`)
}