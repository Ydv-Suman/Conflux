package com.conflux.identityservice.shared.exception;

import com.conflux.identityservice.auth.exception.InvalidCredentialsException;
import com.conflux.identityservice.auth.exception.InvalidVerificationTokenException;
import com.conflux.identityservice.shared.dto.ErrorResponseDto;
import com.conflux.identityservice.team.exception.TeamAccessDeniedException;
import com.conflux.identityservice.team.exception.TeamMembershipConflictException;
import com.conflux.identityservice.team.exception.TeamNotFoundException;
import com.conflux.identityservice.user.exception.PasswordMismatchException;
import com.conflux.identityservice.user.exception.UserNotFoundException;
import com.conflux.identityservice.user.exception.UsernameAlreadyExistsException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ErrorResponseDto> handleInvalidCredentials(
            InvalidCredentialsException ex,
            HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.UNAUTHORIZED, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<ErrorResponseDto> handleRateLimit(
            RateLimitExceededException ex,
            HttpServletRequest request) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header("Retry-After", Long.toString(ex.getRetryAfterSeconds()))
                .body(new ErrorResponseDto(
                        HttpStatus.TOO_MANY_REQUESTS.value(), ex.getMessage(), request.getRequestURI()));
    }

    @ExceptionHandler(PasswordMismatchException.class)
    public ResponseEntity<ErrorResponseDto> handlePasswordMismatch(
            PasswordMismatchException ex,
            HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.BAD_REQUEST, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(InvalidVerificationTokenException.class)
    public ResponseEntity<ErrorResponseDto> handleInvalidVerificationToken(
            InvalidVerificationTokenException ex,
            HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.BAD_REQUEST, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponseDto> handleUserNotFound(
            UserNotFoundException ex, HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.NOT_FOUND, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(TeamNotFoundException.class)
    public ResponseEntity<ErrorResponseDto> handleTeamNotFound(
            TeamNotFoundException ex, HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.NOT_FOUND, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(TeamAccessDeniedException.class)
    public ResponseEntity<ErrorResponseDto> handleTeamAccessDenied(
            TeamAccessDeniedException ex, HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.FORBIDDEN, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(TeamMembershipConflictException.class)
    public ResponseEntity<ErrorResponseDto> handleTeamMembershipConflict(
            TeamMembershipConflictException ex, HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.CONFLICT, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(UsernameAlreadyExistsException.class)
    public ResponseEntity<ErrorResponseDto> handleUsernameAlreadyExists(
            UsernameAlreadyExistsException ex, HttpServletRequest request) {
        return buildErrorResponse(HttpStatus.CONFLICT, ex.getMessage(), request.getRequestURI());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponseDto> handleValidation(
            MethodArgumentNotValidException ex,
            HttpServletRequest request) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .distinct()
                .collect(Collectors.joining("; "));
        return buildErrorResponse(HttpStatus.BAD_REQUEST, message, request.getRequestURI());
    }

    private ResponseEntity<ErrorResponseDto> buildErrorResponse(
            HttpStatus status,
            String message,
            String url) {
        return ResponseEntity.status(status)
                .body(new ErrorResponseDto(status.value(), message, url));
    }
}
