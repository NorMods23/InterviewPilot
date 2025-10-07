const express = require('express');
const OpenAI = require('openai');
const cors = require('cors');

// --- CONFIGURATION ---
const OPENROUTER_KEY = process.env.OPENROUTER_KEY; 
const PORT = 3000;
const MAX_QUESTIONS = { '1': 4, '2': 10, '3': 12, '4': 15 };
const POINTS_PER_QUESTION = 20; 
const POINTS_PER_CONFIDENCE = 5; 
const MAX_TOTAL_SCORE_EACH_TURN = POINTS_PER_QUESTION + POINTS_PER_CONFIDENCE; // 25

// --- INITIALIZATION ---
if (!OPENROUTER_KEY) {
    console.error("FATAL ERROR: OPENROUTER_KEY is not set in environment variables. Server cannot start.");
    process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.static('public'));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_KEY,
    defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "AI Interviewer" },
});

// --- API ENDPOINT FOR THE FIRST QUESTION (STABLE) ---
app.post('/start-interview', async (req, res) => {
    try {
        const { course, level, resumeText } = req.body; 

        const firstQuestion = "Hello, thank you for joining us. Please tell me a little bit about yourself, your background, and your interests."; 
        
        console.log('\n--- INTERVIEW STARTED ---');
        console.log(`User Course: ${course}, Level: ${level}`);
        console.log(`Resume Text Length: ${resumeText.length}`);
        console.log('--------------------------');
        
        res.json({ question: firstQuestion, resumeText }); 
    } catch (error) {
        console.error("Error in /start-interview:", error);
        res.status(500).json({ error: "Failed to start interview." });
    }
});


// --- API ENDPOINT FOR FOLLOW-UP QUESTIONS (Structured Logic & Scoring) ---
app.post('/continue-interview', async (req, res) => {
    try {
        const { conversationHistory, course, level, questionCount, resumeText, focusTopics, skills } = req.body; 
        const maxQuestions = MAX_QUESTIONS[level] || 10;
        
        let interviewEnded = false;
        let systemPrompt;
        let nextQuestion = '';
        
        let specificInstruction = ''; 
        let logCategory = 'Q1: Self Introduction'; 
        let logSource = ''; 
        let scoreChange = 0; // Initialize score change for current turn

        // --- 1. DETERMINE SCORING & INSTRUCTION (Runs before transition check) ---
        // Scoring only applies if we have a full Q&A pair and the question count is 2 or higher (Q1 answer received)
        if (questionCount > 0 && conversationHistory.length >= 2) {
            
            const lastUserAnswer = conversationHistory[conversationHistory.length - 1]?.content || 'No response.';
            const lastAiQuestion = conversationHistory[conversationHistory.length - 2]?.content || '';

            const scoringPrompt = `Analyze the user's last response: "${lastUserAnswer}" to the question: "${lastAiQuestion}". The maximum score for Technical Accuracy is ${POINTS_PER_QUESTION} and the maximum for Confidence/Communication is ${POINTS_PER_CONFIDENCE}. 
            
            Evaluate the answer based on these criteria:
            - Technical Accuracy: 0 (Incorrect), 5 (Partial), 13 (Mostly Correct), 20 (Excellent).
            - Confidence/Communication: +5 (Good/Confident) or 0 (Poor/Unclear). 
            
            Respond ONLY with the final calculated score sum (e.g., 25 or 15). DO NOT add any text, reasoning, or symbols.`;

            try {
                const scoreCompletion = await openai.chat.completions.create({
                    model: "mistralai/mistral-7b-instruct",
                    messages: [{ role: "user", content: scoringPrompt }]
                });
                scoreChange = Math.min(MAX_TOTAL_SCORE_EACH_TURN, 
                    parseInt(scoreCompletion.choices[0].message.content.trim().replace(/[^0-9]/g, '')) || 0
                );
            } catch (e) {
                console.error("Scoring API failed:", e.message);
                scoreChange = 0; 
            }
        }


        // --- 2. CHECK FOR ENDING & NEXT QUESTION LOGIC ---
        if (questionCount >= maxQuestions) {
            // FIX: Added strict instruction to prevent the AI from answering itself.
            systemPrompt = `The interview has reached its question limit. Provide ONLY the concluding remark: "Thank you for your time. We'll be in touch." DO NOT provide an answer or any further text.`;
            // NOTE: interviewEnded is set to true to correctly tell the client to stop the loop.
            interviewEnded = true; 
            logCategory = 'Interview Conclusion';
            logSource = 'End of Question Count Limit';
        } else {
            // --- NEXT QUESTION LOGIC (Same as before) ---
            
            let baseContext = `You are an expert interviewer. The difficulty is level ${level}. The user is a student in ${course}. Their resume states: "${resumeText}". The user has requested to focus on: ${focusTopics}.`;
            
            // Set instruction and log category based on question count
            if (questionCount === 1) {
                logCategory = 'Q2: Project Explanation';
                logSource = 'Based on Resume/Profile';
                specificInstruction = `Question 2: Based on the resume you have, identify a specific project name or title from the resume, and ask the user to explain that project by name. If no project is found, ask: "Can you describe a key project you have recently worked on?"`;
            } else if (questionCount === 2) {
                logCategory = 'Q3: Project Deep Dive';
                logSource = 'Based on Previous Answer (Q2)';
                specificInstruction = `Question 3: Based ONLY on the user's previous answer about their project, ask one technical follow-up question regarding a mistake, a challenge they faced, or a technical choice they made in that project. Do not ask a new topic.`;
            } else if (questionCount >= 3 && questionCount <= 5) {
                logCategory = 'Q4-6: Core Technical Skills';
                const primarySkill = skills.split(',')[0].trim() || 'general topics';
                logSource = `Based on Core Skills (${skills}) & Course (${course})`;
                specificInstruction = `Question 4-6 (Technical Focus): Shift the focus to core foundational knowledge. Ask a technical question based on the key skills (DSA, OOPS, primary programming language). Ensure the question is concise and requires a foundational explanation.`;
            } else if (questionCount >= 6 && questionCount <= 7) {
                logCategory = 'Q7-8: Deep Validation/Resume Authenticity';
                logSource = 'Deep Validation (Testing Resume Honesty)';
                specificInstruction = `Questions 7, 8 (Deep Validation): Ask a deep, highly technical or advanced question to validate the originality of the experience/skills listed in the user's resume. Choose a complex topic related to their most impressive resume point.`;
            } else if (questionCount >= 8 && questionCount <= 9) {
                logCategory = 'Q9-10: Behavioral/Wrap-up';
                logSource = 'Final Behavioral/Situational Question';
                specificInstruction = `Questions 9, 10 (Wrap-up): Ask a high-level behavioral question, a situational question, or a question about their future plans/goals. This should be the final set of questions.`;
            }
            
            if (focusTopics && focusTopics.trim() !== '') {
                 logSource += ` + Focus Topics (${focusTopics})`;
            }

            systemPrompt = `${baseContext} ${specificInstruction} **CRITICAL: You must NEVER repeat a question previously asked in this conversation. DO NOT loiter or include transition phrases like 'Great, I see...' or 'That's interesting.' You MUST return ONLY the text of a single, concise question (under 30 words) on a SINGLE LINE. NEVER return an empty string or multiline text.**
            - Do not provide answers or explanations.
            - If an answer is clearly wrong, you may ask a follow-up specifically about that mistake before moving on, but this is rare.
            - If the user says "I don't know", respond with "No problem." and ask the next question.
            - Do not repeat questions.`;
        }

        const messages = [{ role: "system", content: systemPrompt }, ...conversationHistory.slice(-6)];
        
        // --- 3. RETRY LOGIC for Next Question ---
        let attempt = 0;
        const MAX_ATTEMPTS = 3; 
        let questionSuccess = false;

        while (nextQuestion.length < 5 && attempt < MAX_ATTEMPTS) {
            attempt++;
            const completion = await openai.chat.completions.create({ 
                model: "mistralai/mistral-7b-instruct", 
                messages: messages 
            });
            
            nextQuestion = completion.choices[0].message.content.trim();
            nextQuestion = nextQuestion.replace(/<\/?s>|\[OUT\]|\n|\r/g, '').trim(); 

            if (nextQuestion.length >= 5) {
                questionSuccess = true;
                break; 
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // --- 4. FINAL FALLBACK (If retries fail) ---
        let logStatus = `SUCCESS (Attempt ${attempt})`;

        if (!questionSuccess) {
            logStatus = `FALLBACK_TRIGGERED (All ${MAX_ATTEMPTS} attempts failed)`;
            console.warn(`All ${MAX_ATTEMPTS} attempts failed at Q${questionCount + 1}. Using final dynamic fallback.`);
            
            const primarySkill = skills.split(',')[0].trim() || 'General Topics'; 
            nextQuestion = `I see. Let's cover some fundamentals. Can you explain the core concepts of ${course} using your primary skill, ${primarySkill}?`;
            logSource = `FALLBACK: Used Course/Skill Data`; 
        } else if (attempt > 1) {
            logStatus = `SUCCESS_AFTER_RETRY (Attempt ${attempt})`;
        }

        // --- 5. TERMINAL LOGGING ---
        console.log('--- AI Question Generation Log ---');
        // Only log score if an answer was just received AND it was a scorable turn (Q2 onwards)
        if (questionCount > 0 && conversationHistory.length >= 2) { 
             console.log(`[Q${questionCount}] ANSWER SCORE: +${scoreChange} / ${MAX_TOTAL_SCORE_EACH_TURN}`);
        }
        console.log(`[Q${questionCount + 1}] Category: ${logCategory}`);
        console.log(`[Q${questionCount + 1}] Source: ${logSource}`);
        console.log(`[Q${questionCount + 1}] Status: ${logStatus}`);
        console.log(`[Q${questionCount + 1}] Output: "${nextQuestion}"`);
        console.log('-----------------------------------');
        
        const isEnding = nextQuestion.toLowerCase().includes("thank you");
        
        res.json({ 
            question: nextQuestion, 
            interviewEnded: interviewEnded || isEnding,
            scoreDelta: scoreChange
        });
    } catch (error) {
        console.error("Error in /continue-interview:", error);
        res.status(500).json({ error: "Failed to continue interview." });
    }
});


// --- API ENDPOINT FOR FINAL FEEDBACK GENERATION (STABILITY FIX) ---
app.post('/generate-feedback', async (req, res) => {
    let feedbackText = '';
    const { conversationHistory, resumeText, skills, course, finalScore } = req.body; 

    try {
        // Optimization: Keep prompt extremely simple to reduce timeout chance
        const userHistory = conversationHistory
            .filter(turn => turn.role === 'user')
            .map((turn, index) => `Q${index + 1}: ${turn.content}`)
            .join('\n');


        const prompt = `
            You have already calculated the final score: ${finalScore}/100.
            Write a professional, detailed performance report using the transcript below.
            
            Transcript of User Answers:
            ${userHistory}

            Your response MUST be formatted STRICTLY as follows, adhering to the final score:
            SCORING BREAKDOWN: [Total Score: ${finalScore}/100. Write a 1-2 sentence summary of where points were earned and lost.]
            WHAT WENT WELL: [List 2-3 specific positive observations about the student's performance, e.g., communication clarity, strong start.]
            MISTAKES MADE: [List 2-3 key technical or logical errors the student made, based on the transcript.]
            HOW TO IMPROVE: [Provide actionable advice on how to improve.]
            WHAT TO REFER: [Suggest specific topics, concepts, or technologies the student should study.]
            TONE AND CONFIDENCE: [Provide a brief, constructive assessment of the user's communication style.]
            SELECTION PERCENTAGE: [${finalScore}%]
        `;

        const completion = await openai.chat.completions.create({
            model: "mistralai/mistral-7b-instruct",
            messages: [{ role: "user", content: prompt }]
        });
        
        feedbackText = completion.choices[0].message.content;
        
        if (feedbackText.length < 50 || !feedbackText.includes("SELECTION PERCENTAGE")) {
            throw new Error("AI returned insufficient data, likely due to timeout.");
        }

    } catch (error) {
        console.error("Error calling AI for feedback:", error);
        // --- FINAL FALLBACK: Hardcoded report if AI fails ---
        const finalScoreSafe = finalScore || 55;
        feedbackText = `
SCORING BREAKDOWN: [Total Score: ${finalScoreSafe}/100. Evaluation failed due to API connection failure. Score based on incremental data.]
WHAT WENT WELL: [Your commitment to completing the interview was excellent.]
MISTAKES MADE: [The AI experienced technical difficulties during the review process.]
HOW TO IMPROVE: [Focus on foundational technical skills and ensuring clarity.]
WHAT TO REFER: [Review general industry best practices.]
TONE AND CONFIDENCE: [Your tone remained stable and professional.]
SELECTION PERCENTAGE: [${finalScoreSafe}%]
        `.trim();
    }
    
    // The client-side script will parse this text and store it for download.
    res.json({ feedback: feedbackText });
});


// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server is running successfully on http://localhost:${PORT}`);
});
