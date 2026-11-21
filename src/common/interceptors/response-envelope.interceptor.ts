import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { ApiSuccessResponse } from '@wedding/shared';
import { map, type Observable } from 'rxjs';

/** Wraps every successful controller return value in the shared `{ success: true, data }` envelope. */
@Injectable()
export class ResponseEnvelopeInterceptor<TData> implements NestInterceptor<
  TData,
  ApiSuccessResponse<TData>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<TData>,
  ): Observable<ApiSuccessResponse<TData>> {
    return next.handle().pipe(map((data) => ({ success: true as const, data })));
  }
}
