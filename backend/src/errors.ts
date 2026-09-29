/** An expected API failure, safe to show to the user. */
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "REQUEST_FAILED") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
