const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { getSmartSubtitles } = require("./scraper");

// إعداد مانيفست الإضافة مع إضافة الحقول الإجبارية لتجنب خطأ الـ Linter
const manifest = {
    id: "community.ar_sa.addon",
    version: "1.3.0",
    name: "AR.SA AI Subtitles",
    description: "ترجمات عربية حصرية باستخدام الذكاء الاصطناعي 🇸🇦",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [] // هذا السطر هو حل المشكلة التي ظهرت في الـ Log
};

const builder = new addonBuilder(manifest);

// تعريف الموديل لضمان عدم حدوث خطأ عند استدعاء قاعدة البيانات
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;

    try {
        // البحث والتعريب الذكي
        const results = await getSmartSubtitles(id, Subtitle);

        if (!results || results.length === 0) return { subtitles: [] };

        const subtitles = results.map((sub, index) => {
            const fileId = sub.fileId || `${id.replace(/:/g, '_')}_${index}`;
            
            return {
                id: `arsa_${fileId}`,
                url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/sub/${fileId}.srt`,
                // استخدام كود لغة مخصص ليظهر بشكل منفصل في القائمة
                lang: "ar-SA", 
                label: `🇸🇦 ${sub.label} ${sub.isAI ? '[AI]' : '[OFFICIAL]'}`
            };
        });

        return { subtitles };

    } catch (error) {
        console.error("Handler Error:", error);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
