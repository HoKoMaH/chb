const { addonBuilder } = require("stremio-addon-sdk");
const mongoose = require('mongoose');
const { getSmartSubtitles } = require("./scraper");

const manifest = {
    id: "community.ar_sa.ai",
    version: "2.0.0",
    name: "AI Subtitles By HoKoMaH",
    description: "ترجمات عربية حصرية بالذكاء الاصطناعي 🇸🇦",
    logo: "https://i.imgur.com/huxCzjK.png",
    background: "https://i.imgur.com/Is1Dciv.png", // اختياري
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
