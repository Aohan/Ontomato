export interface HttpErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
}

export interface HttpSuccessResponse<T> {
  success: true;
  data: T;
}

export type HttpResponse<T> = HttpSuccessResponse<T> | HttpErrorResponse;

export type HttpAcknowledgement = { success: true } | HttpErrorResponse;
