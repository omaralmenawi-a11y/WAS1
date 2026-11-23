import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle } from '@/lib/http';
import { applyImport, parseStudentSheet } from '@/lib/school/import';

const MAX_BYTES = 5 * 1024 * 1024;

export const POST = (req: Request) =>
  handle(async () => {
    const actor = await requireUser(req);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('الملف مطلوب');
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('الملف مطلوب');
    if (file.size > MAX_BYTES) throw new ValidationError('حجم الملف كبير جداً (الحد ٥ ميجابايت)');
    const schoolId = actor.schoolId ?? String(form.get('schoolId') ?? '');
    if (!schoolId) throw new ValidationError('المدرسة مطلوبة');
    const parsed = parseStudentSheet(Buffer.from(await file.arrayBuffer()), file.name);
    const result = await applyImport(actor, schoolId, parsed.rows, parsed.rowNumbers);
    const errors = [...parsed.errors, ...result.errors].sort((a, b) => a.row - b.row);
    return Response.json({ created: result.created, updated: result.updated, errors, warnings: parsed.warnings });
  });
