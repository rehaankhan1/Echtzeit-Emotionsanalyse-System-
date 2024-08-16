const express = require('express');
const router = express.Router();

const { ImageAnnotatorClient } = require('@google-cloud/vision');
const { Storage } = require("@google-cloud/storage");

const multer = require('multer');
const sharp = require('sharp');

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Define your API logic here
router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No files were uploaded.");
  }

  const outputFolder = `output_faces_with_emotions_${Date.now()}`; // Generate output folder name
  const response = await clearAndDetectAndSaveFacesWithEmotions(req.file, outputFolder);
  console.log("response", response);
  res.status(200).send(response);
});

async function clearAndDetectAndSaveFacesWithEmotions(imagePath, outputFolder) {
  
  const myJSONArray = {
    apiTimeTaken: "",
    storageTimeTaken: "",
    faces: []
  };

  const storageGCP = new Storage({
    keyFilename: process.env.STORAGE_API_KEY,
  });

  const bucketName = process.env.BUCKET_NAME2;
  
  try {
    const visionGCP = new ImageAnnotatorClient({
      // keyFilename: "acs-example1-1808ecabcbf2.json" 
      keyFilename: process.env.VISION_API_KEY, 
    });
    const imageBuffer = imagePath.buffer;
    
    const apiStartTime = process.hrtime();
    const [result] = await visionGCP.faceDetection(imageBuffer);
    const apiTime = process.hrtime(apiStartTime);
    const faces = result.faceAnnotations;
    console.log('faces:', faces);
    
    // Create output folder in GCS
    await storageGCP.bucket(bucketName).file(outputFolder + '/').save(Buffer.from(''), {
      gzip: true,
      metadata: {
        contentType: "application/x-www-form-urlencoded", // or any other appropriate content type
        cacheControl: "public, max-age=31536000",
      },
    });
    
    const storageStartTime = process.hrtime();
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      const vertices = face.boundingPoly.vertices;
      const minX = Math.min(vertices[0].x, vertices[1].x, vertices[2].x, vertices[3].x);
      const minY = Math.min(vertices[0].y, vertices[1].y, vertices[2].y, vertices[3].y);
      const width = Math.abs(vertices[1].x - vertices[0].x);
      const height = Math.abs(vertices[2].y - vertices[1].y);
      
      const faceImageBuffer = await sharp(imageBuffer)
      .extract({ left: minX, top: minY, width, height })
      .toBuffer();
      
      const dominantEmotion = determineDominantEmotion(face);
      const fileName = `${outputFolder}/${dominantEmotion}/${Date.now()}_${face.faceId}.jpg`;
      await uploadImageToGCS(faceImageBuffer, dominantEmotion, storageGCP, bucketName, fileName)
      
      const imageUrl = getGCSImageUrl(fileName, bucketName);
      
      myJSONArray.faces.push({
        faceId: face.faceId,
        emotion: dominantEmotion,
        detectionConfidence: face.detectionConfidence,
        imageUrl: imageUrl
      })
    }
    const storageTime = process.hrtime(storageStartTime);
    
    
    const apiElapsedTimeInSeconds = calculateElapsedTime(apiTime);
    const storageElapsedTimeInSeconds = calculateElapsedTime(storageTime);
    myJSONArray.apiTimeTaken = apiElapsedTimeInSeconds;
    myJSONArray.storageTimeTaken = storageElapsedTimeInSeconds;
    
    return JSON.stringify(myJSONArray, null, 2);
  } catch (error) {
    console.error('Error:', error);
  }
}

function calculateElapsedTime(time) {
  const elapsedTimeInSeconds = time[0] + time[1] / 1e9;
  return elapsedTimeInSeconds.toFixed(2);
}

async function uploadImageToGCS(faceImageBuffer, dominantEmotion, storageGCP, bucketName, fileName) {
  try {
    await storageGCP.bucket(bucketName).file(fileName).save(faceImageBuffer, {
      gzip: true,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000",
      },
    });

    console.log(`Uploaded ${dominantEmotion} face image to GCS.`);
  } catch (error) {
    console.error('Error uploading image to GCS:', error);
    throw error;
  }
}

function determineDominantEmotion(face) {
  if (face.joyLikelihood === 'VERY_LIKELY' || face.joyLikelihood === 'LIKELY'|| face.joyLikelihood === 'POSSIBLE') 
  {
    return 'joyful';
  } 
  else if (face.sorrowLikelihood === 'VERY_LIKELY' || face.sorrowLikelihood === 'LIKELY'|| face.sorrowLikelihood === 'POSSIBLE') 
  {
    return 'sad';
  } 
  else if (face.angerLikelihood === 'VERY_LIKELY' || face.angerLikelihood === 'LIKELY'|| face.angerLikelihood === 'POSSIBLE') 
  {
    return 'angry';
  } 
  else if (face.surpriseLikelihood === 'VERY_LIKELY' || face.surpriseLikelihood === 'LIKELY'|| face.surpriseLikelihood === 'POSSIBLE') 
  {
    return 'surprise';
  }
  else 
  {
    return 'default';
  }
}

function getGCSImageUrl(fileName, bucketName) {
  return `https://storage.googleapis.com/${bucketName}/${fileName}`;
}

module.exports = router;
