export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code = 'VALIDATION_ERROR') => new HttpError(400, code, message);
export const notFound = (message = 'ไม่พบข้อมูลที่ต้องการ') => new HttpError(404, 'NOT_FOUND', message);
export const conflict = (message, code = 'CONFLICT') => new HttpError(409, code, message);
export const forbidden = (message = 'ไม่มีสิทธิ์ทำรายการนี้', code = 'FORBIDDEN') => new HttpError(403, code, message);
export const payloadTooLarge = (message) => new HttpError(413, 'FILE_TOO_LARGE', message);
export const unsupportedMediaType = (message) => new HttpError(415, 'UNSUPPORTED_FILE_TYPE', message);
