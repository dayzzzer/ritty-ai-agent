import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const teamSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    description: z.string().min(1),
    twitter: z.string().url(),
  }),
);

const factsSchema = z.array(
  z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    source: z.string().url(),
  }),
);

const quizSchema = z.array(
  z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    questionRu: z.string().optional(),
    options: z.array(z.string().min(1)).min(2).max(5),
    correctIndex: z.number().int().min(0),
    explanation: z.string().min(1),
    source: z.string().min(1),
  }),
).superRefine((items, ctx) => {
  for (const item of items) {
    if (item.correctIndex >= item.options.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Question ${item.id} has invalid correctIndex`,
      });
    }
  }
});

export async function loadJsonFile<T>(absolutePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(absolutePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
}

export const dataSchemas = {
  team: teamSchema,
  facts: factsSchema,
  quiz: quizSchema,
};
