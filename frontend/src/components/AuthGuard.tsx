import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "../services/api"

interface Props {
  children: React.ReactNode
}

export default function AuthGuard({ children }: Props) {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) {
      navigate("/login", { replace: true })
      return
    }
    api.getCurrentUser()
      .then((user) => {
        localStorage.setItem("user", JSON.stringify(user))
        setChecking(false)
      })
      .catch(() => {
        api.clearToken()
        navigate("/login", { replace: true })
      })
  }, [navigate])

  if (checking) {
    return (
      <div className="auth-loading">
        <div className="spinner" />
      </div>
    )
  }

  return <>{children}</>
}
