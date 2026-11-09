import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function pageRange({ page, pageSize }: z.infer<typeof paginationSchema>) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}
