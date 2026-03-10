import crypto from 'node:crypto';
import { dataSchemas, loadJsonFile } from './dataLoader.js';
import type { QuizQuestion, QuizSession } from './types.js';
import { pickDistinctRandom } from '../utils/random.js';

export class QuizService {
  private readonly sessions = new Map<string, QuizSession>();

  constructor(private readonly quizDataPath: string) {}

  async createSession(userId: string): Promise<QuizSession> {
    const allQuestions = await loadJsonFile(this.quizDataPath, dataSchemas.quiz);
    const selected = pickDistinctRandom(allQuestions, 5).map((question) => this.shuffleQuestionOptions(question));

    const session: QuizSession = {
      id: crypto.randomUUID(),
      userId,
      questions: selected,
      currentIndex: 0,
      score: 0,
      createdAt: Date.now(),
    };

    this.sessions.set(userId, session);
    return session;
  }

  private shuffleQuestionOptions(question: QuizQuestion): QuizQuestion {
    const optionsWithMarker = question.options.map((option, index) => ({
      option,
      isCorrect: index === question.correctIndex,
    }));

    for (let i = optionsWithMarker.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [optionsWithMarker[i], optionsWithMarker[j]] = [optionsWithMarker[j], optionsWithMarker[i]];
    }

    const shuffledOptions = optionsWithMarker.map((entry) => entry.option);
    const newCorrectIndex = optionsWithMarker.findIndex((entry) => entry.isCorrect);

    return {
      ...question,
      options: shuffledOptions,
      correctIndex: newCorrectIndex,
    };
  }

  getSession(userId: string): QuizSession | undefined {
    return this.sessions.get(userId);
  }

  clearSession(userId: string): void {
    this.sessions.delete(userId);
  }

  answerCurrentQuestion(userId: string, selectedIndex: number): {
    session: QuizSession;
    question: QuizQuestion;
    isCorrect: boolean;
    finished: boolean;
  } {
    const session = this.sessions.get(userId);
    if (!session) {
      throw new Error('No active quiz session.');
    }

    const question = session.questions[session.currentIndex];
    const isCorrect = selectedIndex === question.correctIndex;

    if (isCorrect) {
      session.score += 1;
    }

    session.currentIndex += 1;
    const finished = session.currentIndex >= session.questions.length;

    if (finished) {
      this.sessions.delete(userId);
    }

    return { session, question, isCorrect, finished };
  }
}
