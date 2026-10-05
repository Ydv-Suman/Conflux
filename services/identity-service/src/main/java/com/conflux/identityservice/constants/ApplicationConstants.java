package com.conflux.identityservice.constants;

public final class ApplicationConstants {

    private ApplicationConstants() {
        // Utility class
    }

    public static final String STATUS_200 = "200";
    public static final String MESSAGE_200 = "Request processed successfully";
    public static final String STATUS_201 = "201";
    public static final String MESSAGE_201 = "User created successfully";
    public static final String STATUS_202 = "202";
    public static final String MESSAGE_202 = "Registration request received";

    public static final String STATUS_204 = "204";
    public static final String MESSAGE_204_UPDATE = "User updated successfully";
    public static final String MESSAGE_204_DELETE = "User deleted successfully";

    public static final String STATUS_417 = "417";
    public static final String MESSAGE_417_UPDATE = "Update operation failed. Please try again or contact Dev team";
    public static final String MESSAGE_417_DELETE = "Delete operation failed. Please try again or contact Dev team";

    public static final String PASSWORD_MISMATCH = "Password and confirm password do not match";
}
