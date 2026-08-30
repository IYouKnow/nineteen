import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export default function PageNotFound() {
    const location = useLocation();
    const navigate = useNavigate();
    const pageName = location.pathname.substring(1);

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
            <div className="max-w-md w-full flex flex-col items-center text-center gap-6">
                <div className="space-y-2">
                    <h1 className="text-7xl font-bold tracking-tighter text-foreground/10 select-none">
                        404
                    </h1>
                    <p className="text-xl font-medium text-foreground -mt-4">
                        Oops! Lost in the void
                    </p>
                </div>

                <p className="text-muted-foreground text-sm leading-relaxed max-w-sm">
                    <span className="font-mono text-foreground/80">/{pageName}</span> doesn't seem to exist.
                    Maybe it never did, or maybe it packed its bags and left.
                </p>

                <div className="flex items-center gap-3 pt-2">
                    <Button
                        variant="outline"
                        onClick={() => navigate(-1)}
                    >
                        Go Back
                    </Button>
                    <Button
                        className="bg-foreground text-background hover:bg-foreground/90"
                        onClick={() => navigate('/')}
                    >
                        Go Home
                    </Button>
                </div>
            </div>
        </div>
    );
}
