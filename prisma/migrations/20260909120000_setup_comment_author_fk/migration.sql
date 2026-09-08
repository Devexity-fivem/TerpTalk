-- Add FK for SetupComment.authorId -> User (was a bare string column)
ALTER TABLE "SetupComment" ADD CONSTRAINT "SetupComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
