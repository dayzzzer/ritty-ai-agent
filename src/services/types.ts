export interface ArtworkItem {
  id: string;
  title: string;
  author: string;
  twitter: string;
  src: string;
  createdAt?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  description: string;
  twitter: string;
}

export interface RitualFact {
  id: string;
  text: string;
  source: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  questionRu?: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  source: string;
}

export interface QuizSession {
  id: string;
  userId: string;
  questions: QuizQuestion[];
  currentIndex: number;
  score: number;
  createdAt: number;
}
