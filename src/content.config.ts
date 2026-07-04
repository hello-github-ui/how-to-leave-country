import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const visaCollection = defineCollection({
    loader: glob({
        base: './src/content/visa',
        pattern: '**/*.md',
    }),
    schema: z.object({
        title: z.string(),
        url: z.string().url(),
        category: z.string(),
        source: z.string(),
        date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.date()]),
        summary: z.string().optional(),
        language: z.enum(['en', 'zh']).optional(),
    }),
});

export const collections = {
    visa: visaCollection,
};
