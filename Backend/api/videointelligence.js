const express = require("express");
const multer = require("multer");
const router = express.Router();
const path = require("path");

const Video = require("@google-cloud/video-intelligence").v1;
const { Storage } = require("@google-cloud/storage");

const videoGCP = new Video.VideoIntelligenceServiceClient({
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
    return res.status(400).send("No files were uploaded..",req.file);
  }

  const response = await detectFaces(req.file);
  console.log("response", response);
  res.status(200).json(response);
});


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
    
    const apiStartTime = process.hrtime();
    console.log("apiStartTime:", apiStartTime)
    
    const [operation] = await videoGCP.annotateVideo(request);
    const results = await operation.promise();


    const apiTime = process.hrtime(apiStartTime);
    console.log("apiTime:", apiTime)
    
    const faceAnnotations =
    results[0].annotationResults[0].faceDetectionAnnotations;
    
    const storageStartTime = process.hrtime();
    console.log("storageStartTime:", storageStartTime,"time is",new Date())
    
    if (faceAnnotations.length > 0) {
      for (let i = 0; i < faceAnnotations.length; i++) {
        const faceAnnotation = faceAnnotations[i];
        const thumbnailBase64 = faceAnnotation.thumbnail;
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
          const imgPath = await saveImagesToGCS(facesData, videoPath);
          
          responseData.push({
            id: i,
            timestamp: timestamp,
            img: imgPath,
            attributes: attributes,
          });
        }
      } else {
        console.log("No faces found in the video.");
      }
      
      const storageTime = process.hrtime(storageStartTime);
      console.log("storageTime:", storageTime, storageStartTime,"time is",new Date())
      
      
      const apiElapsedTimeInSeconds = calculateElapsedTime(apiTime);
      const storageElapsedTimeInSeconds = calculateElapsedTime(storageTime);
      
      const transformedData = transformData(responseData);
      
      transformedData.apiTimeTaken = apiElapsedTimeInSeconds;
      transformedData.storageTimeTaken = storageElapsedTimeInSeconds;
      
      return transformedData;
      
    } catch (err) {
      console.log(err);
    }
  }
  
  function transformData(responseData) {
    const transformedData = {
      apiTimeTaken: "",
      storageTimeTaken: "",
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
      const bucketName = process.env.BUCKET_NAME1; // Update with your GCS bucket name
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

function calculateElapsedTime(time) {
  const elapsedTimeInSeconds = (time[0] + time[1] / 1e9).toFixed(2)
  return elapsedTimeInSeconds;
}

module.exports = router;