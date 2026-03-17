const express = require('express');
const { serveHTTP } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');
const engine = require('./engine'); // تأكد من استيراد المحرك

const app = express();

// 1. مسار الإضافة الرسمي (Manifest)
app.use("/", (req, res, next) => {
    if (req.path === '/' || req.path.includes('manifest.json') || req.path.includes('subtitles')) {
        return next();
    }
    next();
});

// 2. مسار تقديم ملف الـ SRT (هذا ما تفتقده الإضافة حالياً)
app.get("/sub/:id.srt", async (req, res) => {
    try {
        const imdbId = req.params.id;
        // جلب الترجمة من قاعدة البيانات (الكاش) التي حفظناها
        const SubtitleModel = mongoose.model('Subtitle'); 
        const sub = await SubtitleModel.findOne({ imdbId });

        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=${imdbId}.srt`);
            return res.send(sub.arabicText);
        }
        res.status(404).send("Subtitle not found");
    } catch (e) {
        res.status(500).send("Internal Error");
    }
});

// تشغيل السيرفر
mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("Connected to MongoDB");
    // دمج Express مع Stremio SDK
    serveHTTP(addonInterface, { app, port: process.env.PORT || 10000 });
});
