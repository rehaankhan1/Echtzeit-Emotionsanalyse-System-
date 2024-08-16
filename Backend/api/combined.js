const express = require("express");
const multer = require("multer");
const router = express.Router();
const path = require("path");
// Import the Buffer module (if you're using Node.js)
const Buffer = require("buffer").Buffer;

const Video = require("@google-cloud/video-intelligence").v1;
const { ImageAnnotatorClient } = require("@google-cloud/vision");
const { Storage } = require("@google-cloud/storage");

const videoGCP = new Video.VideoIntelligenceServiceClient({
  // keyFilename: "acs-example1-84bf30535559.json",
  keyFilename: process.env.VIDEO_INTELLIGENCE_API_KEY,
});

const storageGCP = new Storage({
  //   keyFilename: "acs-example1-ce919d0d4707.json",
  keyFilename: process.env.STORAGE_API_KEY,
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Define your API logic here
router.post("/", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No files were uploaded.");
  }

  const response = await detectFaces(req.file);
  console.log("response", response);
  res.status(200).json(response);
});

module.exports = router;

async function detectFaces(videoPath) {
  const responseData = [];
  try {
    const inputContent = videoPath.buffer.toString("base64");

    const request = {
      inputContent: inputContent,
      features: ["FACE_DETECTION"],
      videoContext: {
        faceDetectionConfig: {
          includeBoundingBoxes: true,
          includeAttributes: true,
        },
      },
    };

    const [operation] = await videoGCP.annotateVideo(request);
    // console.log("Waiting for operation to complete...2", operation);
    const results = await operation.promise();

    const faceAnnotations =
      results[0].annotationResults[0].faceDetectionAnnotations;

    if (faceAnnotations.length > 0) {
      for (let i = 0; i < faceAnnotations.length; i++) {
        const faceAnnotation = faceAnnotations[i];
        const thumbnailBase64 = faceAnnotation.thumbnail;

        const re = await clearAndDetectAndSaveFacesWithEmotions(
          Buffer.from(thumbnailBase64, "base64")
        );

        let timestamp = "";
        let attributes = [];
        for (const { segment, timestampedObjects } of faceAnnotations[i]
          .tracks) {
          timestamp = `${segment.startTimeOffset.seconds}.${(
            segment.startTimeOffset.nanos / 1e6
          ).toFixed(0)}sec`;
          const [firstTimestapedObject] = timestampedObjects;

          for (const { name, confidence } of firstTimestapedObject.attributes) {
            attributes.push({ name, confidence });
          }
        }
        const facesData = { id: i, img: thumbnailBase64 };
        // const visionConfid = confid
        const imgPath = await saveImagesToGCS(facesData, videoPath);
        // console.log("re", re);
        responseData.push({
          id: i,
          currentEmotion: re?.dominantEmotion,
          timestamp: timestamp,
          img: imgPath,
          attributes: attributes,
          visionConfid: re?.confid,
        });
      }
    } else {
      console.log("No faces found in the video.");
    }
    const transformedData = groupByEmotion(responseData);
    return transformedData;
  } catch (err) {
    console.log(err);
  }
}

async function clearAndDetectAndSaveFacesWithEmotions(imagePath) {
  console.log("imagePath:", imagePath);

  try {
    const visionGCP = new ImageAnnotatorClient({
      keyFilename: process.env.VISION_API_KEY,
    });
    const imageBuffer = imagePath;

    // Detect faces in the image
    const [result] = await visionGCP.faceDetection(imageBuffer);
    const faces = result.faceAnnotations;

    console.log("faces:", faces);

    // Save each detected face with its emotions into the respective emotion folder
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];

      // Determine the dominant emotion for the face
      const dominantEmotion = determineDominantEmotion(face);
      console.log("dominantEmotion:", dominantEmotion);
      const a = {
        dominantEmotion: dominantEmotion,
        confid: face.detectionConfidence,
      };
      console.log("a", a);
      return a;
    }
    console.log("Faces detected and saved with emotions.");
  } catch (error) {
    console.error("Error:", error);
  }
}

// Function to determine the dominant emotion for a face
function determineDominantEmotion(face) {
  if (
    face.joyLikelihood === "VERY_LIKELY" ||
    face.joyLikelihood === "LIKELY" ||
    face.joyLikelihood === "POSSIBLE"
  ) {
    return "joyful";
  } else if (
    face.sorrowLikelihood === "VERY_LIKELY" ||
    face.sorrowLikelihood === "LIKELY" ||
    face.sorrowLikelihood === "POSSIBLE"
  ) {
    return "sad";
  } else if (
    face.angerLikelihood === "VERY_LIKELY" ||
    face.angerLikelihood === "LIKELY" ||
    face.angerLikelihood === "POSSIBLE"
  ) {
    return "angry";
  } else if (
    face.surpriseLikelihood === "VERY_LIKELY" ||
    face.surpriseLikelihood === "LIKELY" ||
    face.surpriseLikelihood === "POSSIBLE"
  ) {
    return "surprise";
  } else {
    return "cannot-detect";
  }
}

function transformData(responseData) {
  const transformedData = {
    responseTime: "2sec",
    data: [],
  };

  // Group faces by attribute name
  const groupedFaces = {};
  for (const face of responseData) {
    for (const attribute of face.attributes) {
      if (!(attribute.name in groupedFaces)) {
        groupedFaces[attribute.name] = [];
      }
      groupedFaces[attribute.name].push({
        faceid: face.id,
        confidence: attribute.confidence,
        img: face.img,
        timestamp: face.timestamp,
      });
    }
  }

  // Transform grouped data into the desired format
  for (const [attribute, faces] of Object.entries(groupedFaces)) {
    const attributeData = {
      attributes: attribute,
      faces: faces,
    };
    transformedData.data.push(attributeData);
  }

  return transformedData;
}

async function saveImagesToGCS(facesData, videoPath) {
  const fullVideoPath = videoPath.originalname;

  const videoName = path.basename(fullVideoPath, path.extname(fullVideoPath)); // Extract video name from path
  try {
    const bucketName = process.env.BUCKET_NAME3; // Update with your GCS bucket name
    const folderName = `${videoName}/`; // Folder name will be the video name
    let imagePath = "";
    let destination = `${folderName}${facesData.id}.jpg`; // File path including folder
    const imageBuffer = Buffer.from(facesData.img, "base64");
    const fileName = `${folderName}${facesData.id}.jpg`; // File path including folder

    storageGCP
      .bucket(bucketName)
      .file(destination)
      .save(imageBuffer, {
        gzip: true,
        metadata: {
          contentType: "image/jpeg", // Adjust content type as needed
          cacheControl: "public, max-age=31536000",
        },
      })
      .catch((err) => {
        console.error("Error uploading image:", err);
      });

    // Generate signed URL for the uploaded image
    const [signedUrl] = await storageGCP
      .bucket(bucketName)
      .file(fileName)
      .getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // Link expires in 15 minutes
      });

    imagePath = signedUrl;

    return imagePath;
  } catch (error) {
    console.error("Error saving images to GCS:", error);
    throw error;
  }
}

function groupByEmotion(data) {
  return data.reduce((accumulator, currentEntry) => {
    // Get the emotion from the current entry
    const emotion = currentEntry.currentEmotion;

    // If the accumulator doesn't have an entry for this emotion, create it
    if (!accumulator[emotion]) {
      accumulator[emotion] = [];
    }

    // Add the current entry to the array for this emotion
    accumulator[emotion].push(currentEntry);

    return accumulator;
  }, {});
}
