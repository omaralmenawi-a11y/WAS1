export class AppError extends Error {
  constructor(
    public code: string,
    public messageAr: string,
    public status: number,
  ) {
    super(messageAr);
    this.name = new.target.name;
  }
}

export class RateLimitError extends AppError {
  constructor(messageAr = 'تجاوزت عدد المحاولات المسموح، حاول لاحقاً') {
    super('RATE_LIMIT', messageAr, 429);
  }
}
export class InvalidCredentials extends AppError {
  constructor(messageAr = 'بيانات الدخول غير صحيحة') {
    super('INVALID_CREDENTIALS', messageAr, 401);
  }
}
export class Unauthorized extends AppError {
  constructor(messageAr = 'يجب تسجيل الدخول') {
    super('UNAUTHORIZED', messageAr, 401);
  }
}
export class Forbidden extends AppError {
  constructor(messageAr = 'غير مسموح لك بهذا الإجراء', code = 'FORBIDDEN') {
    super(code, messageAr, 403);
  }
}
export class NotFound extends AppError {
  constructor(messageAr = 'غير موجود') {
    super('NOT_FOUND', messageAr, 404);
  }
}
export class Conflict extends AppError {
  constructor(messageAr = 'العنصر موجود مسبقاً') {
    super('CONFLICT', messageAr, 409);
  }
}
export class ValidationError extends AppError {
  constructor(messageAr = 'بيانات غير صالحة') {
    super('VALIDATION', messageAr, 400);
  }
}
