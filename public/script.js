// --- Global Element Definitions ---
const landingPage = document.getElementById("landing-page");
const formSection = document.getElementById("user-form-section");
const interviewSection = document.getElementById("interview-section");
const generatingResultsSection = document.getElementById("generating-results-section");
const finalResultsSection = document.getElementById("final-results-section");

// Global references for display elements (FIXED SCOPE)
const questionText = document.getElementById("question-text");
const statusText = document.getElementById("status-text");
const resultsContent = document.getElementById("results-content");
const scoreText = document.getElementById("score-text");
const scoreCanvas = document.getElementById("score-canvas");
const ctx = scoreCanvas ? scoreCanvas.getContext('2d') : null; // Initialize context safely

// Global state variables
let conversationHistory = [], userData = {}, questionCount = 0;
let finalReport = "";

// --- API Configuration ---
// DEFINITIVE RENDER URL FOR ALL API CALLS (Update this ONLY if your Render URL changes)
const BASE_API_URL = "https://interviewpilot-tuqn.onrender.com";

// --- Core Function: Page Transition ---
function showSection(sectionToShow) {
    [landingPage, formSection, interviewSection, generatingResultsSection, finalResultsSection].forEach(section => {
        section.classList.add("hidden");
    });
    sectionToShow.classList.remove("hidden");
    // Only run GSAP if it's loaded
    if (typeof gsap !== 'undefined') {
        gsap.from(sectionToShow, { duration: 0.5, opacity: 0, scale: 0.98 });
    }
}

// --- GLOBAL FUNCTION FOR BUTTON FIX ---
// This function is called directly by the onclick="startFormFlow()" attribute in index.html
function startFormFlow() {
    showSection(formSection);
}

// --- ALL OTHER LOGIC IS WRAPPED IN DOMContentLoaded for stability ---
document.addEventListener('DOMContentLoaded', () => {

    // --- Element References (re-defined locally for clarity) ---
    const userForm = document.getElementById("user-form");
    const downloadResultsBtn = document.getElementById("download-results-btn");
    const extractedContentTextarea = document.getElementById('extractedContent');


    // --- Core Functions (speak, listen, drawScore, etc.) ---
    
    function speak(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const britishVoice = voices.find(voice => voice.lang === 'en-GB');
        utterance.voice = britishVoice || voices.find(voice => voice.lang === 'en-US');
        utterance.rate = 1.1;
        speechSynthesis.speak(utterance);
        return new Promise(resolve => { utterance.onend = resolve; });
    }
    speechSynthesis.onvoiceschanged = () => { speechSynthesis.getVoices(); };

    function listen() {
        return new Promise((resolve, reject) => {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) return reject("Speech recognition not supported.");

            const recognition = new SpeechRecognition();
            recognition.interimResults = true;
            recognition.lang = 'en-US';
            
            let finalTranscript = '';
            let recognitionActive = false;

            const handleEnterKey = (event) => {
                if (event.key === 'Enter' && recognitionActive) {
                    event.preventDefault();
                    recognition.stop(); 
                }
            };

            recognition.onstart = () => {
                statusText.innerText = "Listening... (Press ENTER to submit)";
                recognitionActive = true;
                document.addEventListener('keydown', handleEnterKey);
            };

            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    }
                }
            };

            recognition.onerror = (event) => {
                document.removeEventListener('keydown', handleEnterKey);
                recognitionActive = false;
                statusText.innerText = "Mic error."; 
                resolve(finalTranscript.trim()); 
            };
            
            recognition.onend = () => {
                document.removeEventListener('keydown', handleEnterKey);
                recognitionActive = false;
                statusText.innerText = "Analyzing answer...";
                resolve(finalTranscript.trim());
            };

            try {
                recognition.start();
            } catch (e) {
                console.error("Recognition start failed:", e);
                resolve(""); 
            }
        });
    }

    function drawScore(score) {
        if (!scoreCanvas || !ctx) return; 

        const size = 200;
        const radius = size / 2 - 10;
        const center = size / 2;
        const percentage = score / 100;
        const endAngle = Math.PI * 2 * percentage;
        const color = percentage > 0.6 ? '#28a745' : percentage > 0.4 ? '#ffc107' : '#dc3545';

        ctx.clearRect(0, 0, size, size);
        ctx.beginPath();
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        ctx.lineWidth = 15;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + endAngle);
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';
        ctx.stroke();

        scoreText.innerText = `${score}%`;
        scoreText.style.color = color;
    }

    async function handleInterviewTurn(dataForBackend, endpoint) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for questions
            // We use BASE_API_URL here
            const response = await fetch(`${BASE_API_URL}${endpoint}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(dataForBackend), signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error("Server error.");
            
            const data = await response.json();
            const aiQuestion = data.question;
            const scoreDelta = data.scoreDelta || 0; 

            // --- SCORE AGGREGATION & LOGGING (Real-Time) ---
            if (questionCount > 0) {
                let currentScore = userData.currentScore || 0;
                
                currentScore += scoreDelta;
                
                const lastUserIndex = conversationHistory.findIndex(t => t.role === 'user' && !t.scoreDelta);
                if (lastUserIndex !== -1) {
                     conversationHistory[lastUserIndex].scoreDelta = scoreDelta;
                }
                
                console.log(`[CLIENT-SIDE SCORE UPDATE] Question ${questionCount} Score: +${scoreDelta} (Total: ${currentScore})`);
                userData.currentScore = currentScore;
            }
            // --- END SCORE AGGREGATION ---

            conversationHistory.push({ role: 'assistant', content: aiQuestion });
            questionText.innerText = aiQuestion;
            
            await speak(aiQuestion);

            if (data.interviewEnded) {
                statusText.innerText = "Interview Complete";
                generateFinalReport();
                return;
            }

            const userAnswer = await listen();
            conversationHistory.push({ role: 'user', content: userAnswer });
            questionCount++;
            
            handleInterviewTurn({ conversationHistory, ...userData, questionCount }, '/continue-interview');

        } catch (error) {
            console.error("Error:", error);
            questionText.innerText = "An error occurred. Please refresh.";
            statusText.innerText = 'Error';
        }
    }

    async function generateFinalReport() {
        showSection(generatingResultsSection);
        
        const finalScore = userData.currentScore || 0;

        try {
            const controller = new AbortController();
            // 60s timeout for final heavy analysis
            const timeoutId = setTimeout(() => controller.abort(), 60000); 

            // FIXED URL CALL
            const response = await fetch(`${BASE_API_URL}/generate-feedback`, {
                method: "POST",
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationHistory, resumeText: userData.resumeText, skills: userData.skills, course: userData.course, finalScore: finalScore }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error("Server error during feedback generation.");
            
            const data = await response.json();
            finalReport = data.feedback;

            // Display the final score
            drawScore(finalScore);
            resultsContent.innerText = finalReport; 
            showSection(finalResultsSection);

        } catch (error) {
            console.error("Error generating report:", error);
            resultsContent.innerText = "Sorry, the AI timed out during final analysis. Please download the report for preliminary feedback.";
            showSection(finalResultsSection);
        }
    }


    // 2. Form Submission (Start Interview - Uses MANUAL TEXT INPUT)
    userForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(userForm);
        
        // Use current textarea value as resume context
        const resumeTextCache = extractedContentTextarea.value.trim();

        if (resumeTextCache.length < 50) {
            alert("The AI needs your resume text to ask personalized questions. Please paste the raw text content of your resume into the input box (minimum 50 characters).");
            return;
        }

        showSection(interviewSection);
        statusText.innerText = "Initializing AI...";

        // RESET score and history for new interview
        conversationHistory = [];
        userData = {};
        
        const interviewPayload = {
            course: formData.get('course'),
            year: formData.get('year'),
            skills: formData.get('skills'),
            level: formData.get('level'),
            focusTopics: formData.get('focusTopics'),
            resumeText: resumeTextCache // Guaranteed stable data
        };

        try {
            // FIXED URL CALL
            const response = await fetch(`${BASE_API_URL}/start-interview`, { 
                method: "POST", 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(interviewPayload)
            });

            if (!response.ok) throw new Error("Server error during startup.");

            const data = await response.json();
            const firstQuestion = data.question;

            userData = interviewPayload;
            userData.currentScore = 0; // Initialize score tracking on the user data object
            
            questionText.innerText = firstQuestion;
            conversationHistory = [{ role: 'assistant', content: firstQuestion }];
            
            await speak(firstQuestion);
            const userAnswer = await listen();
            
            conversationHistory.push({ role: 'user', content: userAnswer });
            questionCount=1; // Start counting from Q1 answer

            handleInterviewTurn({ conversationHistory, ...userData, questionCount }, '/continue-interview');

        } catch (error) {
            console.error("Error:", error);
            questionText.innerText = "Could not start interview. Please try again. Check server console for errors.";
            statusText.innerText = 'Error';
        }
    });

    // 3. Download Report
    downloadResultsBtn.addEventListener('click', () => {
        const blob = new Blob([finalReport], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'Interview_Report.txt';
        link.click();
    });
    
    // Run GSAP on initial elements (MOVED TO END)
    if (typeof gsap !== 'undefined') {
        gsap.from("header, .tagline, .description, #start-btn", {
            duration: 1,
            opacity: 0,
            y: 50,
            stagger: 0.2,
            ease: "power3.out"
        });
    }
});
