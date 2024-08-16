require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

const corsOptions = {
  origin: 'http://localhost:5173', // Allow only this origin to access
  methods: 'GET,POST', // Allowed request methods
  allowedHeaders: 'Content-Type,Authorization', // Allowed custom headers
  credentials: true, // Allow cookies to be sent with requests
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));
app.use(express.json());

const videoIntelligenceAPI = require("./api/videointelligence");
const visionAPI = require("./api/visionapi");
const combinedAPI = require("./api/combined");

app.use("/api/videointelligence", videoIntelligenceAPI);
app.use("/api/vision", visionAPI);
app.use("/api/combined", combinedAPI);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
