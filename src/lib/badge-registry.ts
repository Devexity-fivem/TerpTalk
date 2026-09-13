// Badge registry and rarity tokens.
// All badge visual and textual data is centralized here so the database only
// needs to store assignments. No schema changes are required.

export const BADGE_RARITIES = ["common", "rare", "epic", "legendary"] as const
export type BadgeRarity = (typeof BADGE_RARITIES)[number]

export interface BadgeDefinition {
  name: string
  description: string
  requirement: string
  rarity: BadgeRarity
  // Name of the Lucide icon component to render.
  icon: string
}

const r = (rarity: BadgeRarity) => rarity

export const BADGE_REGISTRY: BadgeDefinition[] = [
  // Core participation
  { name: "New Grower", description: "Made your first contribution to the community.", requirement: "Post a thread, reply, or grow diary.", rarity: r("common"), icon: "Sprout" },
  { name: "First Post", description: "Made your first post in the forums.", requirement: "Publish one forum reply or thread.", rarity: r("common"), icon: "PenLine" },
  { name: "First Grow Diary", description: "Started tracking a grow.", requirement: "Create one grow diary.", rarity: r("common"), icon: "BookOpen" },
  { name: "First Setup", description: "Showed off your first grow space.", requirement: "Create one setup showcase.", rarity: r("common"), icon: "Monitor" },
  { name: "First Photo", description: "Shared your first strain or grow photo.", requirement: "Upload one strain/grow photo.", rarity: r("common"), icon: "Camera" },

  // Activity milestones
  { name: "Conversation Starter", description: "Started 5 discussion threads.", requirement: "Create 5 forum threads.", rarity: r("rare"), icon: "MessageSquarePlus" },
  { name: "Active Grower", description: "Made 10 forum posts.", requirement: "Publish 10 replies or threads.", rarity: r("common"), icon: "Flame" },
  { name: "Forum Regular", description: "A reliable voice in the forums.", requirement: "Publish 100 replies or threads.", rarity: r("epic"), icon: "MessageSquare" },

  // Content / collection
  { name: "Diary Master", description: "Created 5 grow diaries.", requirement: "Create 5 grow diaries.", rarity: r("rare"), icon: "BookOpen" },
  { name: "Garden Veteran", description: "Created 10 grow diaries.", requirement: "Create 10 grow diaries.", rarity: r("epic"), icon: "TreePine" },
  { name: "Strain Hunter", description: "Added 3 strains to the database.", requirement: "Add 3 strains.", rarity: r("rare"), icon: "Search" },
  { name: "Strain Explorer", description: "Helps catalog genetics.", requirement: "Add 10 strains.", rarity: r("rare"), icon: "Binoculars" },
  { name: "Grow Photographer", description: "Shared 5 strain or grow photos.", requirement: "Upload 5 photos.", rarity: r("rare"), icon: "Camera" },
  { name: "Photo Pro", description: "Shared 25 photos.", requirement: "Upload 25 photos.", rarity: r("epic"), icon: "Aperture" },
  { name: "Setup Specialist", description: "A master of grow-space design.", requirement: "Create 5 setup showcases.", rarity: r("rare"), icon: "Monitor" },

  // Social
  { name: "Social Butterfly", description: "Sent 25 messages in community chat.", requirement: "Send 25 chat messages.", rarity: r("rare"), icon: "MessageCircle" },
  { name: "Recruiter", description: "Referred 3 new members.", requirement: "Have 3 users sign up with your referral code.", rarity: r("rare"), icon: "UserPlus" },
  { name: "Community Builder", description: "Brought 10 new members to the community.", requirement: "Have 10 successful referrals.", rarity: r("epic"), icon: "Users" },

  // Recognition
  { name: "Liked", description: "Received 10 likes on your posts and diaries.", requirement: "Earn 10 likes.", rarity: r("common"), icon: "Heart" },
  { name: "Helpful Member", description: "Received 50 likes.", requirement: "Earn 50 likes.", rarity: r("rare"), icon: "ThumbsUp" },
  { name: "Helpful Grower", description: "Received 20 likes on your posts and diaries.", requirement: "Earn 20 likes.", rarity: r("rare"), icon: "Lightbulb" },
  { name: "Community Favorite", description: "Received 100 likes on your posts and diaries.", requirement: "Earn 100 likes.", rarity: r("epic"), icon: "Heart" },
  { name: "Popular Grower", description: "Received 250 likes.", requirement: "Earn 250 likes.", rarity: r("epic"), icon: "Heart" },
  { name: "Helper", description: "Your reply was marked as an accepted answer.", requirement: "Have one reply accepted.", rarity: r("rare"), icon: "CheckCircle" },
  { name: "Top Helper", description: "5 of your replies were marked as accepted answers.", requirement: "Have 5 replies accepted.", rarity: r("epic"), icon: "Award" },
  { name: "Mentor", description: "A trusted source of knowledge.", requirement: "Have 25 replies accepted.", rarity: r("epic"), icon: "GraduationCap" },

  // Reputation tiers
  { name: "Sprout", description: "Reached 250 reputation.", requirement: "Earn 250 reputation.", rarity: r("common"), icon: "Sprout" },
  { name: "Seedling", description: "Reached 750 reputation.", requirement: "Earn 750 reputation.", rarity: r("common"), icon: "Sprout" },
  { name: "Grower", description: "Reached 1,500 reputation.", requirement: "Earn 1,500 reputation.", rarity: r("common"), icon: "Leaf" },
  { name: "Cultivator", description: "Reached 3,500 reputation.", requirement: "Earn 3,500 reputation.", rarity: r("rare"), icon: "Scissors" },
  { name: "Master Grower", description: "Reached 7,000 reputation.", requirement: "Earn 7,000 reputation.", rarity: r("epic"), icon: "Crown" },
  { name: "Head Grower", description: "Reached 15,000 reputation.", requirement: "Earn 15,000 reputation.", rarity: r("legendary"), icon: "Star" },
  { name: "Hash Maker", description: "Pressed to perfection — reached 40,000 reputation.", requirement: "Earn 40,000 reputation.", rarity: r("legendary"), icon: "Sparkles" },
  { name: "Cannabis Deity", description: "A true deity of the grow room — reached 100,000 reputation.", requirement: "Earn 100,000 reputation.", rarity: r("legendary"), icon: "Crown" },

  // Honours
  { name: "Top Contributor", description: "Reached 10,000 reputation points.", requirement: "Earn 10,000 reputation.", rarity: r("epic"), icon: "TrendingUp" },
  { name: "Dedicated Grower", description: "Posted grow updates 7 days in a row.", requirement: "Update diaries for 7 consecutive days.", rarity: r("epic"), icon: "Flame" },
  { name: "Early Supporter", description: "One of the first to help build TerpTalk.", requirement: "Be among the first 250 registered members.", rarity: r("rare"), icon: "Star" },
  { name: "Beta Tester", description: "Joined TerpTalk during the beta and helped shape the community.", requirement: "Early beta member.", rarity: r("rare"), icon: "Rocket" },
  { name: "Verified YouTuber", description: "A featured cannabis grow content creator on YouTube.", requirement: "Verified by staff as a YouTuber.", rarity: r("epic"), icon: "Video" },
  { name: "Weekly Winner", description: "Won Budshot of the Week.", requirement: "Win a weekly photo contest.", rarity: r("legendary"), icon: "Trophy" },
  { name: "Diary of the Month", description: "Won the monthly grow diary contest.", requirement: "Win Diary of the Month.", rarity: r("legendary"), icon: "Trophy" },
  { name: "Contest Finalist", description: "Reached the final round of a community contest.", requirement: "Finish top 5 in a contest.", rarity: r("rare"), icon: "Medal" },

  // Staff / trust
  { name: "Trusted Member", description: "Recognized by staff as a trusted community member.", requirement: "Awarded by staff.", rarity: r("epic"), icon: "ShieldCheck" },
  { name: "Moderator", description: "Helps keep the community safe.", requirement: "Hold the moderator role.", rarity: r("rare"), icon: "Shield" },
  { name: "Staff", description: "A member of the TerpTalk team.", requirement: "Hold the administrator or staff role.", rarity: r("legendary"), icon: "ShieldCheck" },

  // First steps
  { name: "First Thread", description: "Started your first discussion thread.", requirement: "Create one thread.", rarity: r("common"), icon: "SquarePen" },
  { name: "First Strain", description: "Added your first strain to the database.", requirement: "Add one strain.", rarity: r("common"), icon: "Dna" },

  // Post milestones
  { name: "Prolific Poster", description: "Made 250 forum posts.", requirement: "Publish 250 posts.", rarity: r("rare"), icon: "MessageCircle" },
  { name: "Thread Weaver", description: "Created 100 discussion threads.", requirement: "Create 100 threads.", rarity: r("rare"), icon: "PenLine" },
  { name: "Community Pillar", description: "Made 500 combined posts and threads.", requirement: "Publish 500 posts or threads.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "Century Poster", description: "Made 100 forum posts.", requirement: "Publish 100 posts.", rarity: r("rare"), icon: "MessageCircle" },
  { name: "Veteran Poster", description: "Made 500 forum posts.", requirement: "Publish 500 posts.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "Master Poster", description: "Made 1,000 forum posts.", requirement: "Publish 1,000 posts.", rarity: r("epic"), icon: "MessageSquare" },
  { name: "Grand Poster", description: "Made 2,500 forum posts.", requirement: "Publish 2,500 posts.", rarity: r("legendary"), icon: "PenTool" },
  { name: "Legendary Poster", description: "Made 5,000 forum posts.", requirement: "Publish 5,000 posts.", rarity: r("legendary"), icon: "PenTool" },
  { name: "Mythic Poster", description: "Made 10,000 forum posts.", requirement: "Publish 10,000 posts.", rarity: r("legendary"), icon: "PenTool" },

  // Diary milestones
  { name: "Master Gardener", description: "Created 25 grow diaries.", requirement: "Create 25 grow diaries.", rarity: r("epic"), icon: "BookOpen" },
  { name: "Diary Legend", description: "Created 50 grow diaries.", requirement: "Create 50 grow diaries.", rarity: r("legendary"), icon: "BookMarked" },

  // Strain milestones
  { name: "Strain Master", description: "Added 25 strains to the database.", requirement: "Add 25 strains.", rarity: r("epic"), icon: "Dna" },
  { name: "Strain Legend", description: "Added 50 strains to the database.", requirement: "Add 50 strains.", rarity: r("legendary"), icon: "Dna" },
  { name: "Strain God", description: "Added 100 strains to the database.", requirement: "Add 100 strains.", rarity: r("legendary"), icon: "Dna" },

  // Photo milestones
  { name: "Shutterbug", description: "Shared 50 photos.", requirement: "Upload 50 photos.", rarity: r("epic"), icon: "Aperture" },
  { name: "Photo Legend", description: "Shared 100 photos.", requirement: "Upload 100 photos.", rarity: r("legendary"), icon: "Aperture" },
  { name: "Photo God", description: "Shared 250 photos.", requirement: "Upload 250 photos.", rarity: r("legendary"), icon: "Aperture" },

  // Chat milestones
  { name: "Socialite", description: "Sent 100 chat messages.", requirement: "Send 100 chat messages.", rarity: r("rare"), icon: "MessageCircle" },
  { name: "Talk of the Town", description: "Sent 500 chat messages.", requirement: "Send 500 chat messages.", rarity: r("epic"), icon: "MessageCircle" },
  { name: "Chat Legend", description: "Sent 1,000 chat messages.", requirement: "Send 1,000 chat messages.", rarity: r("legendary"), icon: "MessageCircle" },

  // Referral milestones
  { name: "Ambassador", description: "Brought 25 new members to the community.", requirement: "Have 25 successful referrals.", rarity: r("epic"), icon: "Users" },
  { name: "Founder", description: "Brought 50 new members to the community.", requirement: "Have 50 successful referrals.", rarity: r("legendary"), icon: "Users" },

  // Like milestones
  { name: "Influencer", description: "Received 500 likes.", requirement: "Earn 500 likes.", rarity: r("epic"), icon: "Heart" },
  { name: "Celebrity", description: "Received 1,000 likes.", requirement: "Earn 1,000 likes.", rarity: r("legendary"), icon: "Heart" },

  // Accepted-answer milestones
  { name: "Sage Answer", description: "Had 50 replies marked as accepted answers.", requirement: "Have 50 replies accepted.", rarity: r("epic"), icon: "ScrollText" },
  { name: "Oracle", description: "Had 100 replies marked as accepted answers.", requirement: "Have 100 replies accepted.", rarity: r("legendary"), icon: "ScrollText" },

  // Overall contribution
  { name: "Elite Harvest", description: "Trimmed a serious haul — reached 25,000 reputation.", requirement: "Earn 25,000 reputation.", rarity: r("epic"), icon: "TrendingUp" },
  { name: "Legendary Harvest", description: "Your harvests are the stuff of legends — reached 50,000 reputation.", requirement: "Earn 50,000 reputation.", rarity: r("legendary"), icon: "TrendingUp" },
  { name: "Mythic Harvest", description: "A once-in-a-lifetime haul — reached 100,000 reputation.", requirement: "Earn 100,000 reputation.", rarity: r("legendary"), icon: "TrendingUp" },
]

// ─── TerpBot achievements ───────────────────────────────────────────
// Bot-only badges: awarded exclusively by checkBotBadges() in
// terpbot-events.ts from real BotEvent rows. Deliberately absent from
// BADGE_RULES so checkBadges() can never award them to a human, and so
// /nextbadges never teases members with goals they can't earn.
export const BOT_BADGE_REGISTRY: BadgeDefinition[] = [
  { name: "First Light", description: "Answered its very first command.", requirement: "Successfully answer 1 command (bot only).", rarity: r("common"), icon: "Sun" },
  { name: "Garden Greeter", description: "Welcomed 50 new members to the garden.", requirement: "Post 50 new-member welcomes (bot only).", rarity: r("rare"), icon: "Heart" },
  { name: "Field Guide", description: "Pointed growers to 250 threads, guides, strains, or diaries.", requirement: "Surface 250 internal links (bot only).", rarity: r("rare"), icon: "BookOpen" },
  { name: "Budtender", description: "Helped 50 different members.", requirement: "Assist 50 unique members (bot only).", rarity: r("epic"), icon: "Users" },
  { name: "Tireless Trimmer", description: "Answered 1,000 commands without a day off.", requirement: "Answer 1,000 commands (bot only).", rarity: r("epic"), icon: "Scissors" },
  { name: "Evergreen", description: "Served the community on 90 different days.", requirement: "Be active on 90 distinct days (bot only).", rarity: r("epic"), icon: "TreePine" },
  { name: "Mother Bot", description: "The whole garden leans on it — 500 members assisted.", requirement: "Assist 500 unique members (bot only).", rarity: r("legendary"), icon: "Bot" },
]

// Badges granted only by an administrator's explicit action — never by
// checkBadges(). Whitelist enforced by /api/admin/users PATCH.
export const STAFF_AWARDED_BADGES = new Set(["Trusted Member"])

const BOT_BADGE_NAMES = new Set(BOT_BADGE_REGISTRY.map((b) => b.name))

export function isBotBadge(name: string): boolean {
  return BOT_BADGE_NAMES.has(name)
}

const BADGE_BY_NAME = new Map(
  [...BADGE_REGISTRY, ...BOT_BADGE_REGISTRY].map((b) => [b.name, b])
)

export function getBadgeByName(name: string): BadgeDefinition | undefined {
  return BADGE_BY_NAME.get(name)
}

export function getAllBadges(): BadgeDefinition[] {
  return BADGE_REGISTRY
}
