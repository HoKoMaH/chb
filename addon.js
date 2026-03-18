const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { getSmartSubtitles } = require("./scraper");

const manifest = {
    id: "community.ar_sa.ai",
    version: "1.6.0",
    name: "AR.SA AI Subtitles",
    description: "ترجمات عربية حصرية بالذكاء الاصطناعي 🇸🇦",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
};

const builder = new addonBuilder(manifest);

// استخدام الموديل الموجود أو تعريفه
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: Boolean,
    createdAt: { type: Date, expires: '30d', default: Date.now }
}));

builder.defineSubtitlesHandler(async (args) => {
    const { id } = args;
    try {
        const results = await getSmartSubtitles(id, Subtitle);
        return {
            subtitles: results.map((s, i) => ({
                id: s.fileId || `${id}_${i}`,
                url: `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/sub/${s.fileId || id.replace(/:/g,'_')}.srt`,
                lang: "ar-SA",
                label: `🇸🇦 ${s.label} ${s.isAI ? '[AI]' : '[OFFICIAL]'}`
            }))
        };
    } catch (e) { return { subtitles: [] }; }
});

module.exports = builder.getInterface();
