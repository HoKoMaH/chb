const express = require('express');
const { addonBuilder } = require("stremio-addon-sdk");
const addonInterface = require("./addon");
const mongoose = require('mongoose');

const app = express();

// 1. الاتصال بالقاعدة وتجهيز الموديل
mongoose.connect(process.env.MONGO_URI);
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', new mongoose.Schema({
    imdbId: String,
    arabicText: String,
    source: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
}));

// 2. أهم خطوة: مسار الـ SRT يجب أن يكون في الأعلى جداً وبدون قيود
app.get("/sub/:id.srt", async (req, res) => {
    try {
        const imdbId = req.params.id.split('.')[0]; // يأخذ tt123 من tt123.srt
        console.log(`[HTTP-GET] طلب ملف للـ ID: ${imdbId}`);

        const sub = await Subtitle.findOne({ imdbId });

        if (sub && sub.arabicText) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET');
            return res.send(sub.arabicText);
        }
        
        console.log(`[HTTP-404] لم نعثر على ${imdbId} في القاعدة`);
        res.status(404).send("Subtitle not found. Please trigger search in Stremio first.");
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// 3. دمج إضافة ستريمو مع إكسبريس
const { getRouter } = require("stremio-addon-sdk");
const addonRouter = getRouter(addonInterface);
app.use("/", addonRouter);

// 4. تشغيل السيرفر يدوياً لضمان التحكم الكامل
const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`🚀 السيرفر يعمل الآن`);
    console.log(`🔗 مسار المانيفست: http://localhost:${port}/manifest.json`);
    console.log(`🔗 مسار الترجمة: http://localhost:${port}/sub/tt26443597.srt`);
});
