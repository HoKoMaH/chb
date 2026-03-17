const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("Connected to MongoDB Atlas");
    serveHTTP(addonInterface, { port: process.env.PORT || 7860 });
});