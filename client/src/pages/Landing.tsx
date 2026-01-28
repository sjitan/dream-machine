import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import wolfLogoUrl from "@assets/image_1765606206883.png";
import backgroundVideoUrl from "@assets/WOLFGANG_PHOENIX_BG_1766001809389.mp4";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export default function Landing() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogin = async (destination: string = '/dreams') => {
    if (!username || !password) {
      toast({
        title: "Login Failed",
        description: "Please enter username and password",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      await login(username, password);
      setLocation(destination);
    } catch (error: any) {
      toast({
        title: "Login Failed",
        description: error.message || "Invalid username or password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLogin('/dreams');
  };

  const handleWolfClick = () => {
    handleLogin('/aurora');
  };

  return (
    <div className="h-screen w-screen overflow-hidden relative bg-black text-white">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
        ref={(el) => { if (el) el.playbackRate = 0.75; }}
      >
        <source src={backgroundVideoUrl} type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-black/40" />

      <div className="relative z-10 h-full w-full flex flex-col items-center justify-center px-6">
        <button 
          onClick={handleWolfClick}
          disabled={isLoading}
          className="h-48 w-48 md:h-56 md:w-56 lg:h-64 lg:w-64 rounded-2xl shadow-[0_0_80px_rgba(236,72,153,0.6)] overflow-hidden border-2 border-pink-500/50 mb-2 block cursor-pointer transition-transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="button-aurora-login"
        >
          <img src={wolfLogoUrl} alt="Wolfgang Phoenix Logo - Click to enter Aurora" className="w-full h-full object-cover" />
        </button>
        
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white drop-shadow-lg text-center mb-0">WOLFGANG V</h1>
        <p className="text-xs text-white/60 tracking-[0.3em] mb-2">5.2.1</p>

        <div className="w-full max-w-sm rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_20px_60px_rgba(0,0,0,0.4)] p-5">
          <form onSubmit={handleFormSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="username" className="text-xs text-white/70 font-medium">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                data-testid="input-username"
                className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-lg focus:border-pink-500/50 focus:ring-pink-500/20"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password" className="text-xs text-white/70 font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                data-testid="input-password"
                className="h-10 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-lg focus:border-pink-500/50 focus:ring-pink-500/20"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-10 bg-pink-600 hover:bg-pink-500 text-white font-semibold rounded-lg transition-all shadow-lg shadow-pink-900/40"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
