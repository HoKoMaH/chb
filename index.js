const express = require('express');
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./addon"); // تأكد أن ملف addon.js موجود بجانبه
const mongoose = require('mongoose');

const app = express();

// الاتصال بقاعدة البيانات
mongoose.connect(process.env.MONGO_URI);

// تعريف مسار ملفات الـ SRT
app.get("/sub/:id.srt", async (req, res) => {
    try {
        const imdbId = req.params.id.split('.')[0];
        const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', new mongoose.Schema({
            imdbId: String,
            arabicText: String
        }));
        
        const sub = await Subtitle.findOne({ imdbId });
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

// تشغيل إضافة ستريمو
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`🚀 السيرفر يعمل على منفذ ${port}`);
});
