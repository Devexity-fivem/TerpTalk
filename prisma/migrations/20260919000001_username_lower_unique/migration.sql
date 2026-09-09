-- Case-insensitive unique index for usernames to prevent case-variant races
CREATE UNIQUE INDEX "Profile_username_lower_idx" ON "Profile"(LOWER("username"));
