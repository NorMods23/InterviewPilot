const { GoogleGenerativeAI } = require('@google/generative-ai');

// Paste your NEW, secret API key here
const API_KEY = "AIzaSyCaJGyQe_SCG7khDNFZ0J3LBS-KHqGmy84";

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const models = await genAI.listModels();
        console.log("Your available models are:");
        for (const model of models) {
            console.log(model.name);
        }
    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();