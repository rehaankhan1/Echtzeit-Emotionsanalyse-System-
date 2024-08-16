const express = require("express");
const app = express();
const path = require("path");
const Video = require("@google-cloud/video-intelligence").v1;
const { Storage } = require("@google-cloud/storage");
const fs = require("fs");
const { start } = require("repl");

// Set Google Cloud credentials
process.env.GOOGLE_APPLICATION_CREDENTIALS = "acs-example1-84bf30535559.json";

// Create a Video Intelligence client
const video = new Video.VideoIntelligenceServiceClient({
  keyFilename: "acs-example1-84bf30535559.json",
});

// Create a Storage client

process.env.GOOGLE_APPLICATION_CREDENTIALS = "acs-example1-ce919d0d4707.json";

// Instantiate a storage client
const storage = new Storage({ keyFilename: "acs-example1-ce919d0d4707.json" });

// Path to the local video file
const videoPath = "./demo_1.mp4";

async function saveImagesToGCS(facesData) {
  const videoName = path.basename(videoPath, path.extname(videoPath)); // Extract video name from path
  try {
    const bucketName = "video_intel_api"; // Update with your GCS bucket name
    const folderName = `${videoName}/`; // Folder name will be the video name
    const imagesWithUrls = [];
    let imagePath = "";
    let destination = `${folderName}${facesData.id}.jpg`; // File path including folder
    // console.log("facesData from save to gcp:", facesData);
    // for (const { img } of facesData) {
    // Include timestamp
    const imageBuffer = Buffer.from(facesData.img, "base64");
    // console.log("imgBuffer:", imgBuffer);
    const fileName = `${folderName}${facesData.id}.jpg`; // File path including folder

    // Upload image to GCS
    // console.log(path.resolve("face_0.jpg"))
    // await storage
    //   .bucket(bucketName)
    //   .file(fileName)
    //   .save("face_0.jpg");
    // await storage.bucket(bucketName).upload('face_0.jpg', {
    //   destination: `ro/${fileName}`,
    //   gzip: true,
    //   metadata: {
    //     cacheControl: 'public, max-age=31536000'
    //   }
    // });

    storage
      .bucket(bucketName)
      .file(destination)
      .save(imageBuffer, {
        gzip: true,
        metadata: {
          contentType: "image/jpeg", // Adjust content type as needed
          cacheControl: "public, max-age=31536000",
        },
      })
      .then(() => {
        // console.log(`Image uploaded to ${destination} successfully.`);
      })
      .catch((err) => {
        console.error("Error uploading image:", err);
      });

    // Generate signed URL for the uploaded image
    const [signedUrl] = await storage
      .bucket(bucketName)
      .file(fileName)
      .getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000, // Link expires in 15 minutes
      });

    // Update facesData with the image path
    // console.log("signedUrl:", signedUrl);
    imagePath = signedUrl;
    // imagesWithUrls.push({ faceid, img: imagePath, timestamp }); // Include timestamp
    // }

    return imagePath;
  } catch (error) {
    console.error("Error saving images to GCS:", error);
    throw error;
  }
}

async function detectFaces(videoPath) {
  const responseData = [];
  try {
    const videoName = path.basename(videoPath, path.extname(videoPath)); // Extract video name from path

    // Read the local video file and convert it to base64
    const file = fs.readFileSync(videoPath);
    const inputContent = file.toString("base64");

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

    const [operation] = await video.annotateVideo(request);
    const results = await operation.promise();
    // console.log("Waiting for operation to complete...", results[0]);

    // Gets annotations for video
    const faceAnnotations =
      results[0].annotationResults[0].faceDetectionAnnotations;
    // console.log("check", faceAnnotations[0].tracks.length);

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
        // const imgPath = await saveImagesToGCS(facesData);
        const imgPath = "";
        // console.log("imgPath:", imgPath);

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

    // for (const { tracks } of faceAnnotations) {
    //   console.log("Face detected:");
    //   for (const { segment, timestampedObjects } of tracks) {
    //     console.log(
    //       `\tStart: ${segment.startTimeOffset.seconds}` +
    //         `.${(segment.startTimeOffset.nanos / 1e6).toFixed(0)}s`
    //     );
    //     console.log(
    //       `\tEnd: ${segment.endTimeOffset.seconds}.` +
    //         `${(segment.endTimeOffset.nanos / 1e6).toFixed(0)}s`
    //     );

    //     // Each segment includes timestamped objects that
    //     // include characteristics of the face detected.
    //     const [firstTimestapedObject] = timestampedObjects;
    //     // console.log("firstTimestapedObject:", firstTimestapedObject.attributes);

    //     for (const { name, confidence } of firstTimestapedObject.attributes) {
    //       // Attributes include 'glasses', 'headwear', 'smiling'.
    //       console.log(`\tAttribute: ${name} with confidence: ${confidence}; `);
    //       //   console.log(`\tAttribute: ${name}; `);
    //     }
    //   }
    // }
    // console.log("responseData:", JSON.stringify(responseData));
    // console.log("____________________________________________");
    const transformedData = transformData(responseData);
    return (JSON.stringify(transformedData, null, 2));
  } catch (err) {
    console.log(err);
  }
}

function transformData(responseData) {
  const transformedData = {
    responseTime: '2sec',
    data: []
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
        timestamp: face.timestamp
      });
    }
  }

  // Transform grouped data into the desired format
  for (const [attribute, faces] of Object.entries(groupedFaces)) {
    const attributeData = {
      attributes: attribute,
      faces: faces
    };
    transformedData.data.push(attributeData);
  }

  return transformedData;
}

// saveImagesToGCS({ id: 1, img: "" });
response =   detectFaces(videoPath);