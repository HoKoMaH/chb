const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

// 1. تعريف الـ Manifest
const manifest = {
    id: "community.ar.sa.smart",
    version: "7.9.0",
    name: "AR.SA Smart Subtitles",
    description: "ترجمة عربية ذكية ومزامنة تلقائية لكافة المحتويات",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

// 2. بناء الإضافة
const builder = new addonBuilder(manifest);

// 3. تعريف الـ Handler الخاص بالترجمة
builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || ""; 

    console.log(`[ADDON] 📥 طلب ترجمة لـ: ${id} | الملف: ${videoFileName}`);

    try {
        // استدعاء المحرك الذكي من engine.js
        const subs = await engine.getSyncedSubtitles(id, videoFileName);
        
        if (!subs || subs.length === 0) return { subtitles: [] };

        // تحويل النتائج لتنسيق ستريميو
        const formattedSubs = subs.map(sub => ({
            id: sub.fileId,
            url: `https://chb-gy3n.onrender.com/sub/${sub.fileId}.srt`,
            name: `${sub.isAI ? '🤖 ' : '🇸🇦 '}${sub.label}${sub.isMatch ? ' ⭐' : ''}`
        }));

        return { subtitles: formattedSubs };
    } catch (e) {
        console.error(`[ADDON-ERROR] ❌ فشل في جلب الترجمة: ${e.message}`);
        return { subtitles: [] };
    }
});

// 4. التصدير (مهم جداً لحل خطأ Undefined config)
const addonInterface = builder.getInterface();
module.exports = addonInterface;
