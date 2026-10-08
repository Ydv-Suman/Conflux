package com.conflux.identityservice.user.mapper;

import com.conflux.identityservice.user.dto.UserDto;
import com.conflux.identityservice.user.entity.User;
import org.springframework.stereotype.Component;

@Component
public class UserMapper {

    public UserDto toUserDto(User user) {
        UserDto userDto = new UserDto();
        userDto.setFirstName(user.getFirstName());
        userDto.setMiddleName(user.getMiddleName());
        userDto.setLastName(user.getLastName());
        userDto.setEmail(user.getPrimaryEmail().getEmail());
        userDto.setEmailVerified(user.getPrimaryEmail().getVerifiedAt() != null);
        userDto.setUsername(user.getUsername());
        userDto.setCreatedAt(user.getCreatedAt());
        return userDto;
    }

}
