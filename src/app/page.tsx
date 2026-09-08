import { Leaf, Users, MessageSquare, Award } from "lucide-react"
import Link from "next/link"

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-primary/10 p-4 rounded-full">
              <Leaf className="w-12 h-12 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground mb-6">
            Welcome to TerpTalk
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            The ultimate community for cannabis growers to share experiences, grow diaries, and connect with fellow enthusiasts.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth/signup" className="bg-primary text-primary-foreground px-8 py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors text-center">
              Join Community
            </Link>
            <Link href="/diaries" className="border border-border bg-secondary text-secondary-foreground px-8 py-3 rounded-lg font-medium hover:bg-secondary/80 transition-colors text-center">
              Explore Grow Diaries
            </Link>
          </div>
        </div>
      </section>

      {/* Community Stats */}
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-secondary/50">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-primary mb-2">15,284</div>
              <div className="text-muted-foreground">Members</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary mb-2">2,431</div>
              <div className="text-muted-foreground">Grow Diaries</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary mb-2">84,291</div>
              <div className="text-muted-foreground">Discussions</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-primary mb-2">327</div>
              <div className="text-muted-foreground">Growers Online</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Everything You Need to Grow</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Community Forums</h3>
              <p className="text-muted-foreground">
                Engage in discussions about growing techniques, equipment, genetics, and more with experienced cultivators.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Leaf className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Grow Diaries</h3>
              <p className="text-muted-foreground">
                Document your entire grow journey from seed to harvest with detailed updates, photos, and environmental data.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <MessageSquare className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Live Chat</h3>
              <p className="text-muted-foreground">
                Connect with growers in real-time through our live chat rooms. Get instant answers and share experiences.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Award className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Reputation System</h3>
              <p className="text-muted-foreground">
                Earn badges and build your reputation through helpful contributions and community engagement.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Leaf className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Setup Showcases</h3>
              <p className="text-muted-foreground">
                Share your grow setup and equipment. Get feedback and inspiration from the community.
              </p>
            </div>
            <div className="bg-card p-6 rounded-lg border border-border">
              <div className="bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Strain Database</h3>
              <p className="text-muted-foreground">
                Explore and contribute to our community-maintained strain database with genetics and growing characteristics.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-primary/10">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Join TerpTalk Today</h2>
          <p className="text-xl text-muted-foreground mb-8">
            Join thousands of growers sharing knowledge and experiences. Your next great grow starts here.
          </p>
          <Link href="/auth/signup" className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors">
            Create Free Account
          </Link>
        </div>
      </section>
    </div>
  )
}
