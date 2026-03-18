const { addonBuilder } = require("stremio-addon-sdk");
const engine = require("./engine");

// 1. تعريف الـ Manifest (تأكد أن هذا الجزء موجود ومعرف بوضوح)
const manifest = {
    id: "community.ar.sa.smart",
    version: "7.8.5",
    name: "AR.SA Smart Subtitles",
    description: "ترجمة عربية ذكية ومزامنة تلقائية لكافة المحتويات",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    background: "https://i.imgur.com/your_background.jpg", 
    logo: "https://i.imgur.com/your_logo.png"
};

// 2. بناء الإضافة
const builder = new addonBuilder(manifest);

// 3. تعريف الـ Handler الخاص بالترجمة
builder.defineSubtitlesHandler(async (args) => {
    const { id, extra } = args;
    const videoFileName = extra.filename || ""; // استلام اسم ملف الفيديو للمزامنة

    console.log(`[ADDON] 📥 طلب ترجمة لـ: ${id} | الملف: ${videoFileName}`);

    try {
        // استدعاء المحرك الذكي
        const subs = await engine.getSyncedSubtitles(id, videoFileName);
        
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

// 4. التصدير (هذا السطر هو الأهم لحل الخطأ الخاص بك)
const addonInterface = builder.getInterface();
module.exports = addonInterface;
