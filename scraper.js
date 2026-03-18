/**
 * دالة ترجمة النص مع لوقات تفصيلية للتشخيص
 */
async function translateLineContent(text, lineIndex) {
    if (!text || text.trim() === "") return text;
    if (text.includes('-->') || /^\d+$/.test(text.trim())) return text;

    const key = getNextKey();
    if (!key) {
        console.error(`[LOG-ERR] لا يوجد مفتاح API متاح للسطر رقم ${lineIndex}`);
        return text;
    }

    try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Act as a movie translator. Translate to Arabic: ${text}`;
        
        // لوق قبل الإرسال
        console.log(`[DEBUG] إرسال للترجمة (سطر ${lineIndex}): "${text.substring(0, 20)}..."`);

        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim();
        
        if (!responseText) {
            console.warn(`[LOG-WARN] Gemini أعاد استجابة فارغة للسطر ${lineIndex}`);
            return text;
        }

        console.log(`[DEBUG] تم استقبال الترجمة: "${responseText.substring(0, 20)}..."`);
        return responseText.replace(/^["']|["']$/g, '');
    } catch (e) {
        console.error(`[LOG-CRITICAL] خطأ في الـ API عند السطر ${lineIndex}: ${e.message}`);
        return text; 
    }
}

/**
 * معالج الملف مع نظام مراقبة التدفق
 */
async function translateToArabic(sourceSrt) {
    if (!sourceSrt) {
        console.error("[LOG-ERR] الملف المصدر فارغ تماماً قبل البدء!");
        return "";
    }

    const lines = sourceSrt.replace(/\r/g, '').split('\n');
    console.log(`[LOG-INFO] تم تحليل الملف: إجمالي الأسطر ${lines.length}`);

    let finalSrtArray = [];

    for (let i = 0; i < lines.length; i++) {
        let currentLine = lines[i];

        if (currentLine.includes('-->') || /^\d+$/.test(currentLine.trim()) || currentLine.trim() === "") {
            finalSrtArray.push(currentLine);
        } else {
            // ننتظر الترجمة ونرى ماذا سيحدث
            const translated = await translateLineContent(currentLine, i);
            finalSrtArray.push(translated);
        }

        // لوق حيوي للتأكد أن المصفوفة تكبر ولا تتوقف عند أول سطر
        if (i < 5 || i % 100 === 0) {
            console.log(`[LOG-STATUS] المصفوفة الآن تحتوي على ${finalSrtArray.length} سطر.`);
        }
    }

    const finalResult = finalSrtArray.join('\n');
    console.log(`[LOG-FINISH] اكتملت المعالجة. حجم الملف النهائي: ${finalResult.length} حرف.`);
    
    if (finalResult.length < 100) {
        console.error("[LOG-FATAL] تحذير: الملف النهائي قصير جداً بشكل غير منطقي!");
    }

    return finalResult;
}
