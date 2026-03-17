const scraper = require('./scraper');
const mongoose = require('mongoose');

// تعريف الـ Schema محلياً لضمان تسجيلها قبل الاستخدام
const SubtitleSchema = new mongoose.Schema({
    fileId: { type: String, unique: true },
    imdbId: String,
    arabicText: String,
    label: String,
    createdAt: { type: Date, expires: '7d', default: Date.now }
});

// هذه السطر يفحص إذا كان الموديل موجوداً، وإذا لم يكن، ينشئه
const Subtitle = mongoose.models.Subtitle || mongoose.model('Subtitle', SubtitleSchema);

async function getSyncedSubtitles(imdbId) {
    try {
        console.log(`[ENGINE] جاري البحث عن خيارات متعددة لـ: ${imdbId}`);
        const allSubs = await scraper.fetchAllPossibleSubs(imdbId);

        if (allSubs && allSubs.length > 0) {
            let results = [];
            for (let i = 0; i < Math.min(allSubs.length, 5); i++) {
                const sub = allSubs[i];
                const fileId = `${imdbId}_v${i + 1}`;

                const exists = await Subtitle.findOne({ fileId });
                if (!exists) {
                    await new Subtitle({
                        fileId: fileId,
                        imdbId: imdbId,
                        arabicText: sub.content,
                        label: sub.releaseName || `نسخة مزمّنة ${i + 1}`
                    }).save();
                }
                results.push({ fileId: fileId, label: sub.releaseName || `Option ${i + 1}` });
            }
            return results;
        }
    } catch (e) {
        console.error(`[ENGINE-ERROR] ${e.message}`);
    }
    return [];
}

module.exports = { getSyncedSubtitles };
