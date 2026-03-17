const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

// الاتصال بـ MongoDB
mongoose.connect(process.env.MONGO_URI);

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

app.get("/sub/:fileId.srt", async (req, res) => {
    try {
        const fileId = req.params.fileId.replace('.srt', '');
        const sub = await Subtitle.findOne({ fileId });

        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(sub.arabicText);
        }
        res.status(404).send("Subtitle not found.");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
