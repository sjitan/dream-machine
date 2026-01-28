import { useQuery, useQueryClient } from "@tanstack/react-query";

const AUTH_QUERY_KEY = ["/api/auth/user"];
const TOKEN_STORAGE_KEY = "wolfgang_auth_token";

interface AuthUser {
  username: string;
}

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    console.error("Failed to store auth token");
  }
}

function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    console.error("Failed to clear auth token");
  }
}

async function fetchUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) {
    return null;
  }
  
  try {
    const res = await fetch("/api/auth/user", {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });
    
    if (res.status === 401) {
      clearStoredToken();
      return null;
    }
    
    if (!res.ok) {
      return null;
    }
    
    return res.json();
  } catch {
    return null;
  }
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchUser,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const login = async (username: string, password: string): Promise<AuthUser> => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Login failed");
    }
    
    const result = await res.json();
    
    // Store the token
    setStoredToken(result.token);
    
    // Update the cache
    const userData: AuthUser = { username: result.username };
    queryClient.setQueryData(AUTH_QUERY_KEY, userData);
    
    return userData;
  };

  const logout = async () => {
    const token = getStoredToken();
    
    try {
      await fetch("/api/logout", {
        method: "POST",
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
    } catch {
      // Ignore logout errors
    }
    
    // Clear the token and cache
    clearStoredToken();
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    getToken: getStoredToken,
  };
}

// Export for use in API calls
export function getAuthToken(): string | null {
  return getStoredToken();
}
