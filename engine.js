const mongoose = require('mongoose');
const scraper = require('./scraper');

const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    isAI: { type: Boolean, default: false },
    createdAt: { type: Date, expires: '15d', default: Date.now }
});
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(fullId, videoFileName) {
    try {
        // 1. فحص القاعدة المحلية أولاً (لسرعة البرق)
        const localSubs = await Subtitle.find({ imdbId: fullId }).sort({ createdAt: -1 });
        if (localSubs.length > 0) {
            console.log(`[ENGINE] 🏠 جلب ${localSubs.length} من القاعدة.`);
            return localSubs.map(sub => ({ fileId: sub.fileId, label: sub.label, isAI: sub.isAI }));
        }

        // 2. الجلب الخارجي المتوازي (Parallel Fetching)
        console.log(`[ENGINE] 🌐 جاري جلب المصادر الخارجية لـ ${fullId}...`);
        const externalSubs = await scraper.fetchAllPossibleSubs(fullId, videoFileName);
        
        if (!externalSubs || externalSubs.length === 0) return [];

        // معالجة وحفظ الترجمات دفعة واحدة لتقليل الوقت
        const savePromises = externalSubs.map(async (sub) => {
            const newFileId = `${fullId.replace(/:/g, '_')}_${sub.source}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            const savedSub = new Subtitle({
                fileId: newFileId,
                imdbId: fullId,
                arabicText: sub.content,
                label: sub.releaseName || "Source",
                isAI: sub.source === "AI"
            });
            await savedSub.save();
            return { fileId: savedSub.fileId, label: savedSub.label, isAI: savedSub.isAI };
        });

        const results = await Promise.all(savePromises);
        console.log(`[ENGINE] ✨ تم حفظ وإرسال ${results.length} ترجمة.`);
        return results;

    } catch (e) {
        console.error(`[ENGINE-ERROR] ❌: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
