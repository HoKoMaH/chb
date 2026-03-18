const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { getSmartSubtitles } = require("./scraper");

const manifest = {
    id: "community.ar_sa.addon",
    version: "1.3.0",
    name: "AR.SA AI Subtitles",
    description: "قائمة ترجمة خاصة وحصرية باستخدام الذكاء الاصطناعي",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

// تعريف الموديل (لضمان عمل الهاندلر)
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
        const results = await getSmartSubtitles(id, Subtitle);

        if (!results || results.length === 0) return { subtitles: [] };

        const subtitles = results.map((sub, index) => {
            const fileId = sub.fileId || `${id.replace(/:/g, '_')}_${index}`;
            
            return {
                id: `arsa_${fileId}`,
                url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/sub/${fileId}.srt`,
                /** * التعديل هنا: 
                 * باستخدام 'ar-SA' أو 'Arabic (AR-SA)'، سيقوم ستريميو بإظهارها 
                 * كخيار منفصل تماماً عن خيار 'Arabic' التقليدي.
                 */
                lang: "ar-SA", 
                // الوسم الذي سيظهر بجانب العلم أو رمز اللغة
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
