const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { getSmartSubtitles } = require("./scraper");

// 1. إعداد مانيفست الإضافة
const manifest = {
    id: "community.ar_sa.addon",
    version: "1.2.0",
    name: "AR.SA Subtitles AI",
    description: "البحث عن ترجمات عربية جاهزة أو تعريب الترجمات الإنجليزية فورياً باستخدام AI",
    logo: "https://i.imgur.com/83pL6D6.png", // يمكنك تغيير الرابط لشعارك
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    background: "https://i.imgur.com/S99S46H.jpeg",
    idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

/**
 * تعريف موديل قاعدة البيانات لضمان الوصول للبيانات المخزنة
 */
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

/**
 * معالج طلبات الترجمة (Subtitles Handler)
 */
builder.defineSubtitlesHandler(async (args) => {
    const { id } = args; // معرف الفيلم tt123456 أو الحلقة tt123456:1:1
    console.log(`🔍 طلب ترجمة للمعرف: ${id}`);

    try {
        // استدعاء الوظيفة الذكية من السكريبت
        // تتبع النظام: Subdl Arabic -> Database -> Subdl English + AI
        const results = await getSmartSubtitles(id, Subtitle);

        if (!results || results.length === 0) {
            console.log("⚠️ لم يتم العثور على أي ترجمات لهذا المحتوى.");
            return { subtitles: [] };
        }

        // تحويل النتائج إلى الصيغة التي يفهمها Stremio
        const subtitles = results.map((sub, index) => {
            // نستخدم المعرف الموجود أو ننشئ واحدًا مؤقتًا
            const fileId = sub.fileId || `${id.replace(/:/g, '_')}_res_${index}`;
            
            return {
                id: fileId,
                // الرابط يشير إلى سيرفرك على Render ليقوم بتقديم ملف الـ SRT
                url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'chb-gy3n.onrender.com'}/sub/${fileId}.srt`,
                lang: "Arabic",
                label: `${sub.label} ${sub.isAI ? '✨ [AI]' : '✅ [Official]'}`
            };
        });

        return { subtitles };

    } catch (error) {
        console.error("❌ خطأ في معالج الترجمة:", error.message);
        return { subtitles: [] };
    }
});

module.exports = builder.getInterface();
