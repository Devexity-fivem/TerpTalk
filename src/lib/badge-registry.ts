// Badge registry and rarity tokens.
// All badge visual and textual data is centralized here so the database only
// needs to store assignments. No schema changes are required.
//
// `progress` is the single source of truth for stat-based grants: the grant
// rule in lib/reputation.ts (BADGE_RULES) is generated from it, and the
// achievements UI reads the same spec to show "73 / 100" progress.

export const BADGE_RARITIES = ["common", "rare", "epic", "legendary"] as const
export type BadgeRarity = (typeof BADGE_RARITIES)[number]

export const BADGE_CATEGORIES = [
  "first-steps",
  "community",
  "grows",
  "knowledge",
  "social",
  "outreach",
  "milestones",
  "honours",
  "staff",
] as const
export type BadgeCategory = (typeof BADGE_CATEGORIES)[number]

export const BADGE_CATEGORY_LABELS: Record<BadgeCategory, string> = {
  "first-steps": "First Steps",
  community: "Community",
  grows: "Grow Diaries",
  knowledge: "Knowledge",
  social: "Social",
  outreach: "Outreach",
  milestones: "Milestones",
  honours: "Honours",
  staff: "Staff",
}

// Stat names map to keys on UserStats (src/lib/reputation.ts). Multiple
// stats are summed. direction "lte" means "at most" (e.g. member number).
export interface BadgeProgressSpec {
  stats: string[]
  target: number
  direction?: "gte" | "lte"
}

export interface BadgeDefinition {
  name: string
  description: string
  requirement: string
  rarity: BadgeRarity
  category: BadgeCategory
  // Name of the Lucide icon component to render.
  icon: string
  progress?: BadgeProgressSpec
}

const r = (rarity: BadgeRarity) => rarity
const p = (stats: string | string[], target: number, direction: "gte" | "lte" = "gte"): BadgeProgressSpec =>
  ({ stats: Array.isArray(stats) ? stats : [stats], target, direction })

export const BADGE_REGISTRY: BadgeDefinition[] = [
  // ─── First steps ───
  { name: "New Grower", description: "Made your first contribution to the community.", requirement: "Post a thread, reply, or grow diary.", rarity: r("common"), category: "first-steps", icon: "Sprout", progress: p(["posts", "threads", "diaries"], 1) },
  { name: "First Post", description: "Made your first post in the forums.", requirement: "Publish one forum reply.", rarity: r("common"), category: "first-steps", icon: "PenLine", progress: p("posts", 1) },
  { name: "First Thread", description: "Started your first discussion thread.", requirement: "Create one thread.", rarity: r("common"), category: "first-steps", icon: "SquarePen", progress: p("threads", 1) },
  { name: "First Grow Diary", description: "Started tracking a grow.", requirement: "Create one grow diary.", rarity: r("common"), category: "first-steps", icon: "BookOpen", progress: p("diaries", 1) },
  { name: "First Setup", description: "Showed off your first grow space.", requirement: "Create one setup showcase.", rarity: r("common"), category: "first-steps", icon: "Monitor", progress: p("setups", 1) },
  { name: "First Photo", description: "Shared your first strain or grow photo.", requirement: "Upload one strain/grow photo.", rarity: r("common"), category: "first-steps", icon: "Camera", progress: p("strainPhotos", 1) },
  { name: "First Strain", description: "Added your first strain to the database.", requirement: "Add one strain.", rarity: r("common"), category: "first-steps", icon: "Dna", progress: p("strains", 1) },

  // ─── Community (forum) ───
  { name: "Conversation Starter", description: "Started 5 discussion threads.", requirement: "Create 5 forum threads.", rarity: r("rare"), category: "community", icon: "MessageSquarePlus", progress: p("threads", 5) },
  { name: "Active Grower", description: "Made 10 forum posts.", requirement: "Publish 10 replies.", rarity: r("common"), category: "community", icon: "Flame", progress: p("posts", 10) },
  { name: "Forum Regular", description: "A reliable voice in the forums.", requirement: "Publish 100 replies or threads.", rarity: r("epic"), category: "community", icon: "MessageSquare", progress: p(["posts", "threads"], 100) },
  { name: "Prolific Poster", description: "Made 250 forum posts.", requirement: "Publish 250 posts.", rarity: r("rare"), category: "community", icon: "MessageCircle", progress: p("posts", 250) },
  { name: "Thread Weaver", description: "Created 100 discussion threads.", requirement: "Create 100 threads.", rarity: r("epic"), category: "community", icon: "PenLine", progress: p("threads", 100) },
  { name: "Community Pillar", description: "Made 500 combined posts and threads.", requirement: "Publish 500 posts or threads.", rarity: r("epic"), category: "community", icon: "MessageSquare", progress: p(["posts", "threads"], 500) },
  { name: "Century Poster", description: "Made 100 forum posts.", requirement: "Publish 100 posts.", rarity: r("rare"), category: "community", icon: "MessageCircle", progress: p("posts", 100) },
  { name: "Veteran Poster", description: "Made 500 forum posts.", requirement: "Publish 500 posts.", rarity: r("epic"), category: "community", icon: "MessageSquare", progress: p("posts", 500) },
  { name: "Master Poster", description: "Made 1,000 forum posts.", requirement: "Publish 1,000 posts.", rarity: r("epic"), category: "community", icon: "MessageSquare", progress: p("posts", 1000) },
  { name: "Grand Poster", description: "Made 2,500 forum posts.", requirement: "Publish 2,500 posts.", rarity: r("legendary"), category: "community", icon: "PenTool", progress: p("posts", 2500) },
  { name: "Legendary Poster", description: "Made 5,000 forum posts.", requirement: "Publish 5,000 posts.", rarity: r("legendary"), category: "community", icon: "PenTool", progress: p("posts", 5000) },
  { name: "Mythic Poster", description: "Made 10,000 forum posts.", requirement: "Publish 10,000 posts.", rarity: r("legendary"), category: "community", icon: "PenTool", progress: p("posts", 10000) },

  // Accepted answers
  { name: "Helper", description: "Your reply was marked as an accepted answer.", requirement: "Have one reply accepted.", rarity: r("rare"), category: "community", icon: "CheckCircle", progress: p("acceptedAnswers", 1) },
  { name: "Top Helper", description: "5 of your replies were marked as accepted answers.", requirement: "Have 5 replies accepted.", rarity: r("epic"), category: "community", icon: "Award", progress: p("acceptedAnswers", 5) },
  { name: "Mentor", description: "A trusted source of knowledge.", requirement: "Have 25 replies accepted.", rarity: r("epic"), category: "community", icon: "GraduationCap", progress: p("acceptedAnswers", 25) },
  { name: "Sage Answer", description: "Had 50 replies marked as accepted answers.", requirement: "Have 50 replies accepted.", rarity: r("epic"), category: "community", icon: "ScrollText", progress: p("acceptedAnswers", 50) },
  { name: "Oracle", description: "Had 100 replies marked as accepted answers.", requirement: "Have 100 replies accepted.", rarity: r("legendary"), category: "community", icon: "ScrollText", progress: p("acceptedAnswers", 100) },

  // ─── Grow diaries ───
  { name: "Diary Master", description: "Created 5 grow diaries.", requirement: "Create 5 grow diaries.", rarity: r("rare"), category: "grows", icon: "BookOpen", progress: p("diaries", 5) },
  { name: "Garden Veteran", description: "Created 10 grow diaries.", requirement: "Create 10 grow diaries.", rarity: r("epic"), category: "grows", icon: "TreePine", progress: p("diaries", 10) },
  { name: "Master Gardener", description: "Created 25 grow diaries.", requirement: "Create 25 grow diaries.", rarity: r("epic"), category: "grows", icon: "BookOpen", progress: p("diaries", 25) },
  { name: "Diary Legend", description: "Created 50 grow diaries.", requirement: "Create 50 grow diaries.", rarity: r("legendary"), category: "grows", icon: "BookMarked", progress: p("diaries", 50) },
  { name: "Dedicated Grower", description: "Posted grow updates 7 days in a row.", requirement: "Update diaries for 7 consecutive days.", rarity: r("epic"), category: "grows", icon: "Flame" },

  // ─── Knowledge (strains, photos, setups) ───
  { name: "Strain Hunter", description: "Added 3 strains to the database.", requirement: "Add 3 strains.", rarity: r("common"), category: "knowledge", icon: "Search", progress: p("strains", 3) },
  { name: "Strain Explorer", description: "Helps catalog genetics.", requirement: "Add 10 strains.", rarity: r("rare"), category: "knowledge", icon: "Binoculars", progress: p("strains", 10) },
  { name: "Strain Master", description: "Added 25 strains to the database.", requirement: "Add 25 strains.", rarity: r("epic"), category: "knowledge", icon: "Dna", progress: p("strains", 25) },
  { name: "Strain Legend", description: "Added 50 strains to the database.", requirement: "Add 50 strains.", rarity: r("legendary"), category: "knowledge", icon: "Dna", progress: p("strains", 50) },
  { name: "Strain God", description: "Added 100 strains to the database.", requirement: "Add 100 strains.", rarity: r("legendary"), category: "knowledge", icon: "Dna", progress: p("strains", 100) },
  { name: "Grow Photographer", description: "Shared 5 strain or grow photos.", requirement: "Upload 5 photos.", rarity: r("rare"), category: "knowledge", icon: "Camera", progress: p("strainPhotos", 5) },
  { name: "Photo Pro", description: "Shared 25 photos.", requirement: "Upload 25 photos.", rarity: r("epic"), category: "knowledge", icon: "Aperture", progress: p("strainPhotos", 25) },
  { name: "Shutterbug", description: "Shared 50 photos.", requirement: "Upload 50 photos.", rarity: r("epic"), category: "knowledge", icon: "Aperture", progress: p("strainPhotos", 50) },
  { name: "Photo Legend", description: "Shared 100 photos.", requirement: "Upload 100 photos.", rarity: r("legendary"), category: "knowledge", icon: "Aperture", progress: p("strainPhotos", 100) },
  { name: "Photo God", description: "Shared 250 photos.", requirement: "Upload 250 photos.", rarity: r("legendary"), category: "knowledge", icon: "Aperture", progress: p("strainPhotos", 250) },
  { name: "Setup Specialist", description: "A master of grow-space design.", requirement: "Create 5 setup showcases.", rarity: r("rare"), category: "knowledge", icon: "Monitor", progress: p("setups", 5) },

  // ─── Social ───
  { name: "Social Butterfly", description: "Sent 25 messages in community chat.", requirement: "Send 25 chat messages.", rarity: r("rare"), category: "social", icon: "MessageCircle", progress: p("chatMessages", 25) },
  { name: "Socialite", description: "Sent 100 chat messages.", requirement: "Send 100 chat messages.", rarity: r("rare"), category: "social", icon: "MessageCircle", progress: p("chatMessages", 100) },
  { name: "Talk of the Town", description: "Sent 500 chat messages.", requirement: "Send 500 chat messages.", rarity: r("epic"), category: "social", icon: "MessageCircle", progress: p("chatMessages", 500) },
  { name: "Chat Legend", description: "Sent 1,000 chat messages.", requirement: "Send 1,000 chat messages.", rarity: r("legendary"), category: "social", icon: "MessageCircle", progress: p("chatMessages", 1000) },
  { name: "Liked", description: "Received 10 likes on your posts and diaries.", requirement: "Earn 10 likes.", rarity: r("common"), category: "social", icon: "Heart", progress: p("likesReceived", 10) },
  { name: "Helpful Grower", description: "Received 20 likes on your posts and diaries.", requirement: "Earn 20 likes.", rarity: r("rare"), category: "social", icon: "Lightbulb", progress: p("likesReceived", 20) },
  { name: "Helpful Member", description: "Received 50 likes.", requirement: "Earn 50 likes.", rarity: r("rare"), category: "social", icon: "ThumbsUp", progress: p("likesReceived", 50) },
  { name: "Community Favorite", description: "Received 100 likes on your posts and diaries.", requirement: "Earn 100 likes.", rarity: r("epic"), category: "social", icon: "Heart", progress: p("likesReceived", 100) },
  { name: "Popular Grower", description: "Received 250 likes.", requirement: "Earn 250 likes.", rarity: r("epic"), category: "social", icon: "Heart", progress: p("likesReceived", 250) },
  { name: "Influencer", description: "Received 500 likes.", requirement: "Earn 500 likes.", rarity: r("epic"), category: "social", icon: "Heart", progress: p("likesReceived", 500) },
  { name: "Celebrity", description: "Received 1,000 likes.", requirement: "Earn 1,000 likes.", rarity: r("legendary"), category: "social", icon: "Heart", progress: p("likesReceived", 1000) },

  // ─── Outreach ───
  { name: "Recruiter", description: "Referred 3 new members.", requirement: "Have 3 users sign up with your referral code.", rarity: r("rare"), category: "outreach", icon: "UserPlus", progress: p("referrals", 3) },
  { name: "Community Builder", description: "Brought 10 new members to the community.", requirement: "Have 10 successful referrals.", rarity: r("epic"), category: "outreach", icon: "Users", progress: p("referrals", 10) },
  { name: "Ambassador", description: "Brought 25 new members to the community.", requirement: "Have 25 successful referrals.", rarity: r("epic"), category: "outreach", icon: "Users", progress: p("referrals", 25) },
  { name: "Founder", description: "Brought 50 new members to the community.", requirement: "Have 50 successful referrals.", rarity: r("legendary"), category: "outreach", icon: "Users", progress: p("referrals", 50) },

  // ─── Milestones (reputation) ───
  { name: "Sprout", description: "Reached 250 reputation.", requirement: "Earn 250 reputation.", rarity: r("common"), category: "milestones", icon: "Sprout", progress: p("reputation", 250) },
  { name: "Rooted", description: "Reached 750 reputation.", requirement: "Earn 750 reputation.", rarity: r("common"), category: "milestones", icon: "Leaf", progress: p("reputation", 750) },
  { name: "Grower", description: "Reached 1,500 reputation.", requirement: "Earn 1,500 reputation.", rarity: r("common"), category: "milestones", icon: "Leaf", progress: p("reputation", 1500) },
  { name: "Cultivator", description: "Reached 3,500 reputation.", requirement: "Earn 3,500 reputation.", rarity: r("rare"), category: "milestones", icon: "Scissors", progress: p("reputation", 3500) },
  { name: "Master Grower", description: "Reached 7,000 reputation.", requirement: "Earn 7,000 reputation.", rarity: r("epic"), category: "milestones", icon: "Crown", progress: p("reputation", 7000) },
  { name: "Head Grower", description: "Reached 15,000 reputation.", requirement: "Earn 15,000 reputation.", rarity: r("legendary"), category: "milestones", icon: "Star", progress: p("reputation", 15000) },
  { name: "Hash Maker", description: "Pressed to perfection — reached 40,000 reputation.", requirement: "Earn 40,000 reputation.", rarity: r("legendary"), category: "milestones", icon: "Sparkles", progress: p("reputation", 40000) },
  { name: "Cannabis Deity", description: "A true deity of the grow room — reached 100,000 reputation.", requirement: "Earn 100,000 reputation.", rarity: r("legendary"), category: "milestones", icon: "Crown", progress: p("reputation", 100000) },
  { name: "Top Contributor", description: "Reached 10,000 reputation points.", requirement: "Earn 10,000 reputation.", rarity: r("epic"), category: "milestones", icon: "TrendingUp", progress: p("reputation", 10000) },
  { name: "Elite Harvest", description: "Trimmed a serious haul — reached 25,000 reputation.", requirement: "Earn 25,000 reputation.", rarity: r("epic"), category: "milestones", icon: "TrendingUp", progress: p("reputation", 25000) },
  { name: "Legendary Harvest", description: "Your harvests are the stuff of legends — reached 50,000 reputation.", requirement: "Earn 50,000 reputation.", rarity: r("legendary"), category: "milestones", icon: "TrendingUp", progress: p("reputation", 50000) },
  { name: "Mythic Harvest", description: "A once-in-a-lifetime haul — reached 100,000 reputation.", requirement: "Earn 100,000 reputation.", rarity: r("legendary"), category: "milestones", icon: "TrendingUp", progress: p("reputation", 100000) },

  // ─── Honours (event/staff-driven — no stat progress) ───
  { name: "Early Supporter", description: "One of the first to help build TerpTalk.", requirement: "Be among the first 250 registered members.", rarity: r("rare"), category: "honours", icon: "Star", progress: p("memberNumber", 250, "lte") },
  { name: "Beta Tester", description: "Joined TerpTalk during the beta and helped shape the community.", requirement: "Early beta member.", rarity: r("rare"), category: "honours", icon: "Rocket" },
  { name: "Verified YouTuber", description: "A featured cannabis grow content creator on YouTube.", requirement: "Verified by staff as a YouTuber.", rarity: r("epic"), category: "honours", icon: "Video" },
  { name: "Weekly Winner", description: "Won Budshot of the Week.", requirement: "Win a weekly photo contest.", rarity: r("legendary"), category: "honours", icon: "Trophy" },
  { name: "Diary of the Month", description: "Won the monthly grow diary contest.", requirement: "Win Diary of the Month.", rarity: r("legendary"), category: "honours", icon: "Trophy" },
  { name: "Contest Finalist", description: "Reached the final round of a community contest.", requirement: "Finish top 5 in a contest.", rarity: r("rare"), category: "honours", icon: "Medal" },

  // ─── Staff ───
  { name: "Trusted Member", description: "Recognized by staff as a trusted community member.", requirement: "Awarded by staff.", rarity: r("epic"), category: "staff", icon: "ShieldCheck" },
  { name: "Moderator", description: "Helps keep the community safe.", requirement: "Hold the moderator role.", rarity: r("rare"), category: "staff", icon: "Shield" },
  { name: "Staff", description: "A member of the TerpTalk team.", requirement: "Hold the administrator or staff role.", rarity: r("legendary"), category: "staff", icon: "ShieldCheck" },
]

// ─── TerpBot achievements ───────────────────────────────────────────
// Bot-only badges: awarded exclusively by checkBotBadges() in
// terpbot-events.ts from real BotEvent rows. Deliberately absent from
// BADGE_RULES so checkBadges() can never award them to a human, and so
// /nextbadges never teases members with goals they can't earn.
// `progress` stat names map to keys on BotStats.
export const BOT_BADGE_REGISTRY: BadgeDefinition[] = [
  { name: "First Light", description: "Answered its very first command.", requirement: "Successfully answer 1 command (bot only).", rarity: r("common"), category: "milestones", icon: "Sun", progress: p("commands", 1) },
  { name: "Garden Greeter", description: "Welcomed 50 new members to the garden.", requirement: "Post 50 new-member welcomes (bot only).", rarity: r("rare"), category: "honours", icon: "Heart", progress: p("welcomes", 50) },
  { name: "Field Guide", description: "Pointed growers to 250 threads, guides, strains, or diaries.", requirement: "Surface 250 internal links (bot only).", rarity: r("rare"), category: "knowledge", icon: "BookOpen", progress: p("entityLinks", 250) },
  { name: "Budtender", description: "Helped 50 different members.", requirement: "Assist 50 unique members (bot only).", rarity: r("epic"), category: "social", icon: "Users", progress: p("membersAssisted", 50) },
  { name: "Tireless Trimmer", description: "Answered 1,000 commands without a day off.", requirement: "Answer 1,000 commands (bot only).", rarity: r("epic"), category: "milestones", icon: "Scissors", progress: p("commands", 1000) },
  { name: "Evergreen", description: "Served the community on 90 different days.", requirement: "Be active on 90 distinct days (bot only).", rarity: r("epic"), category: "milestones", icon: "TreePine", progress: p("daysActive", 90) },
  { name: "Mother Bot", description: "The whole garden leans on it — 500 members assisted.", requirement: "Assist 500 unique members (bot only).", rarity: r("legendary"), category: "social", icon: "Bot", progress: p("membersAssisted", 500) },
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
