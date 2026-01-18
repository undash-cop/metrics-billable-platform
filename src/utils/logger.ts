import { Env } from '../types/env.js';

/**
 * Structured Logging Utility
 * 
 * Provides structured logging with consistent format for:
 * - Event tracking
 * - Error debugging
 * - Performance monitoring
 * - Audit trails
 * 
 * Logs are structured JSON for easy parsing and analysis.
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export interface LogContext {
  // Request context
  requestId?: string;
  userId?: string;
  organisationId?: string;
  projectId?: string;
  
  // Operation context
  operation?: string;
  entityType?: string;
  entityId?: string;
  
  // Performance
  duration?: number; // milliseconds
  statusCode?: number;
  
  // Error context
  error?: {
    message: string;
    code: string;
    stack?: string;
  };
  
  // Custom fields
  [key: string]: unknown;
}

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  environment: string;
  context: LogContext;
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private service: string;
  private environment: string;

  constructor(env: Env) {
    this.service = 'metrics-billable-platform';
    this.environment = env.ENVIRONMENT || 'development';
  }

  /**
   * Create structured log entry
   */
  private createLog(
    level: LogLevel,
    message: string,
    context: LogContext = {}
  ): StructuredLog {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      environment: this.environment,
      context,
    };
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: LogContext): void {
    const log = this.createLog(LogLevel.DEBUG, message, context);
    console.log(JSON.stringify(log));
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    const log = this.createLog(LogLevel.INFO, message, context);
    console.log(JSON.stringify(log));
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    const log = this.createLog(LogLevel.WARN, message, context);
    console.warn(JSON.stringify(log));
  }

  /**
   * Log error message
   */
  error(message: string, context?: LogContext): void {
    const log = this.createLog(LogLevel.ERROR, message, context);
    console.error(JSON.stringify(log));
  }

  /**
   * Log fatal error
   */
  fatal(message: string, context?: LogContext): void {
    const log = this.createLog(LogLevel.FATAL, message, context);
    console.error(JSON.stringify(log));
  }

  /**
   * Log with error object
   */
  logError(error: unknown, context?: LogContext): void {
    const errorContext: LogContext = {
      ...context,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };

    this.error(
      error instanceof Error ? error.message : 'Unknown error occurred',
      errorContext
    );
  }

  /**
   * Log operation start
   */
  logOperationStart(operation: string, context?: LogContext): void {
    this.info(`Operation started: ${operation}`, {
      ...context,
      operation,
    });
  }

  /**
   * Log operation completion
   */
  logOperationComplete(
    operation: string,
    duration: number,
    context?: LogContext
  ): void {
    this.info(`Operation completed: ${operation}`, {
      ...context,
      operation,
      duration,
    });
  }

  /**
   * Log operation failure
   */
  logOperationFailure(
    operation: string,
    error: unknown,
    duration: number,
    context?: LogContext
  ): void {
    const errorContext: LogContext = {
      ...context,
      operation,
      duration,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        code: error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN',
        stack: error instanceof Error ? error.stack : undefined,
      },
    };

    this.error(`Operation failed: ${operation}`, errorContext);
  }
}

/**
 * Create logger instance
 */
export function createLogger(env: Env): Logger {
  return new Logger(env);
}
