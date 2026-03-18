const scraper = require('./scraper');
const mongoose = require('mongoose');

/**
 * تعريف الـ Schema محلياً لضمان عدم حدوث خطأ MissingSchemaError
 * في حال استدعاء الملف قبل index.js
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
 * الوظيفة الأساسية لجلب ومزامنة الترجمات
 * @param {string} fullId - المعرف (مثال للأفلام: tt12345 | مثال للمسلسلات: tt12345:1:1)
 * @param {string} videoFileName - اسم ملف الفيديو المشغل حالياً
 */
async function getSyncedSubtitles(fullId, videoFileName) {
    console.log(`\n[ENGINE-START] 🎯 معالجة الطلب لـ: ${fullId}`);
    console.log(`[ENGINE-VIDEO] 🎬 ملف المستخدم: ${videoFileName}`);
    
    try {
        // 1. البحث في قاعدة البيانات أولاً (Cache First)
        // نستخدم fullId للبحث لضمان دقة الحلقة والموسم
        const cachedSubs = await Subtitle.find({ imdbId: fullId });
        
        if (cachedSubs && cachedSubs.length > 0) {
            console.log(`[ENGINE-CACHE] 📦 وجدنا ${cachedSubs.length} ترجمة مخزنة. تخطي البحث الخارجي.`);
            return cachedSubs.map(sub => ({
                fileId: sub.fileId,
                label: sub.label,
                isAI: sub.isAI,
                // فحص المطابقة لتحديد النجمة ⭐
                isMatch: (videoFileName || "").toLowerCase().includes((sub.label || "").toLowerCase().split('.')[0])
            }));
        }

        // 2. إذا لم يوجد كاش، نطلب من السكرابر البحث الخارجي والترجمة
        console.log(`[ENGINE-REMOTE] 🌐 الكاش فارغ. جاري بدء السكرابر والتعريب الذكي...`);
        const allSubs = await scraper.fetchAllPossibleSubs(fullId, videoFileName);
        
        if (!allSubs || allSubs.length === 0) {
            console.log(`[ENGINE-EMPTY] ⚠️ للأسف، لم نجد أي نتائج متوافقة (أصلية أو قابلة للترجمة).`);
            return [];
        }

        let results = [];
        for (let i = 0; i < allSubs.length; i++) {
            const sub = allSubs[i];
            
            // تنظيف المعرف لاستخدامه في الرابط (تحويل : إلى _)
            const cleanId = fullId.replace(/:/g, '_');
            const fileId = `${cleanId}_v${i + 1}_smart`;

            // تحديد هل النسخة مطابقة تقنياً (BluRay, WEB-DL, YTS...)
            const isMatch = (videoFileName || "").toLowerCase().includes((sub.releaseName || "").toLowerCase().split('.')[0]);
            const isAIResult = sub.source === "AI";

            console.log(`[ENGINE-SAVE] 💾 جاري حفظ نسخة: ${sub.releaseName} | نوع: ${isAIResult ? 'AI 🤖' : 'Original 🇸🇦'}`);
            
            // حفظ أو تحديث الترجمة في MongoDB
            await Subtitle.findOneAndUpdate(
                { fileId: fileId },
                { 
                    imdbId: fullId, 
                    arabicText: sub.content, 
                    label: sub.releaseName,
                    isAI: isAIResult
                },
                { upsert: true, new: true }
            );
            
            results.push({ 
                fileId, 
                label: sub.releaseName, 
                isMatch, 
                isAI: isAIResult 
            });
        }
        
        // ترتيب النتائج: المطابق أولاً، ثم الأصلي، ثم الـ AI
        return results.sort((a, b) => b.isMatch - a.isMatch);

    } catch (e) {
        console.error(`[ENGINE-CRITICAL-ERROR] ❌ فشل في محرك المزامنة: ${e.message}`);
        return [];
    }
}

module.exports = { getSyncedSubtitles };
