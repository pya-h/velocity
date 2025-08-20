import { VelocityRequest, VelocityResponse } from '../types';

export class TransformInterceptor {
  public intercept(data: any, req: VelocityRequest, res: VelocityResponse): any {
    if (data === null || data === undefined) {
      return data;
    }

    // Add metadata to response
    const transformedData = {
      data: data,
      meta: {
        timestamp: new Date().toISOString(),
        path: req.url,
        method: req.method,
        statusCode: res.statusCode
      }
    };

    return transformedData;
  }
}
