"use client";

type MetroWasteLoadingProps = {
  title?: string;
  message?: string;
  compact?: boolean;
};

export function MetroWasteLoading({
  title = "MetroWaste Administration",
  message = "Preparing your operations workspace…",
  compact = false,
}: MetroWasteLoadingProps) {
  return (
    <main
      className={`mw-loader-page ${compact ? "compact" : ""}`}
      aria-live="polite"
      aria-busy="true"
      aria-label={title}
    >
      <div className="mw-loader-glow mw-loader-glow-a" aria-hidden="true" />
      <div className="mw-loader-glow mw-loader-glow-b" aria-hidden="true" />

      <section className="mw-loader-shell">
        <header className="mw-loader-brand">
          <img src="/metrowaste-logo.jpg" alt="MetroWaste logo" />
          <div>
            <strong>MetroWaste Administration</strong>
            <span>Solid Waste Management Corp.</span>
          </div>
        </header>

        <div className="mw-truck-scene" aria-hidden="true">
          <div className="mw-sky">
            <span className="mw-cloud mw-cloud-a" />
            <span className="mw-cloud mw-cloud-b" />
          </div>

          <div className="mw-horizon">
            <span className="mw-hill mw-hill-one" />
            <span className="mw-hill mw-hill-two" />
            <span className="mw-city mw-city-a" />
            <span className="mw-city mw-city-b" />
            <span className="mw-city mw-city-c" />
          </div>

          <div className="mw-road-perspective">
            <div className="mw-road-surface">
              <div className="mw-road-center-lines">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          <div className="mw-truck-shadow" />

          <div className="mw-truck-driver">
            <div className="mw-truck-3d">
              <div className="mw-truck-box">
                <div className="mw-truck-box-side">
                  <img src="/metrowaste-logo.jpg" alt="" />
                  <span>METROWASTE</span>
                </div>
                <div className="mw-truck-box-top" />
                <div className="mw-truck-box-back" />
              </div>

              <div className="mw-truck-cab">
                <div className="mw-cab-side">
                  <div className="mw-cab-window" />
                  <div className="mw-cab-door-line" />
                  <div className="mw-cab-handle" />
                </div>

                <div className="mw-cab-front">
                  <div className="mw-windshield" />
                  <span className="mw-headlight mw-headlight-top" />
                  <span className="mw-headlight mw-headlight-bottom" />
                </div>

                <div className="mw-cab-roof" />
              </div>

              <div className="mw-truck-chassis" />

              <div className="mw-wheel mw-wheel-back">
                <div className="mw-wheel-rim" />
              </div>

              <div className="mw-wheel mw-wheel-middle">
                <div className="mw-wheel-rim" />
              </div>

              <div className="mw-wheel mw-wheel-front">
                <div className="mw-wheel-rim" />
              </div>
            </div>
          </div>
        </div>

        <div className="mw-loader-copy">
          <h1>{title}</h1>
          <p>{message}</p>
        </div>

        <div className="mw-loader-progress" aria-hidden="true">
          <span />
        </div>

        <div className="mw-loader-status">
          <span className="mw-status-dot" />
          <span>MetroWaste secure system</span>
        </div>
      </section>

      <style jsx global>{`
        .mw-loader-page,
        .mw-loader-page * {
          box-sizing: border-box;
        }

        .mw-loader-page {
          min-height: 100dvh;
          position: relative;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: 24px;
          background:
            radial-gradient(
              circle at 18% 16%,
              rgba(16, 185, 129, 0.15),
              transparent 31%
            ),
            radial-gradient(
              circle at 88% 85%,
              rgba(5, 116, 77, 0.1),
              transparent 34%
            ),
            linear-gradient(180deg, #f6fbf8 0%, #edf6f1 100%);
          color: #102238;
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .mw-loader-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(20px);
          pointer-events: none;
          opacity: 0.5;
        }

        .mw-loader-glow-a {
          width: 360px;
          height: 360px;
          left: -130px;
          top: -110px;
          background: rgba(14, 165, 105, 0.12);
        }

        .mw-loader-glow-b {
          width: 320px;
          height: 320px;
          right: -90px;
          bottom: -120px;
          background: rgba(5, 111, 74, 0.1);
        }

        .mw-loader-shell {
          width: min(100%, 760px);
          position: relative;
          z-index: 2;
          display: grid;
          justify-items: center;
          padding: 28px 32px 30px;
          border: 1px solid rgba(210, 227, 218, 0.92);
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.84);
          box-shadow:
            0 30px 80px rgba(19, 57, 39, 0.11),
            inset 0 1px 0 rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(12px);
        }

        .mw-loader-brand {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
        }

        .mw-loader-brand img {
          width: 54px;
          height: 54px;
          flex: 0 0 54px;
          border-radius: 50%;
          object-fit: contain;
          background: #fff;
          box-shadow: 0 8px 18px rgba(17, 52, 34, 0.11);
        }

        .mw-loader-brand strong,
        .mw-loader-brand span {
          display: block;
        }

        .mw-loader-brand strong {
          color: #123626;
          font-size: 18px;
          line-height: 1.2;
          font-weight: 900;
        }

        .mw-loader-brand span {
          margin-top: 2px;
          color: #6b7d73;
          font-size: 11px;
          line-height: 1.3;
        }

        .mw-truck-scene {
          position: relative;
          width: min(100%, 680px);
          height: 280px;
          margin-top: 18px;
          overflow: hidden;
          perspective: 1000px;
          perspective-origin: 50% 35%;
          border-radius: 22px;
          background:
            linear-gradient(
              180deg,
              #eaf8f1 0%,
              #f6fbf8 45%,
              #d8eadf 46%,
              #c6ddd0 100%
            );
          box-shadow:
            inset 0 0 0 1px rgba(127, 165, 145, 0.18),
            0 12px 30px rgba(18, 58, 38, 0.05);
        }

        .mw-sky,
        .mw-horizon,
        .mw-road-perspective {
          position: absolute;
          inset: 0;
        }

        .mw-cloud {
          position: absolute;
          height: 18px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.72);
          filter: blur(0.4px);
        }

        .mw-cloud-a {
          width: 84px;
          top: 38px;
          left: 13%;
          animation: mwCloudFloatA 10s ease-in-out infinite alternate;
        }

        .mw-cloud-b {
          width: 112px;
          top: 59px;
          right: 11%;
          opacity: 0.55;
          animation: mwCloudFloatB 13s ease-in-out infinite alternate;
        }

        .mw-horizon {
          top: auto;
          height: 120px;
          bottom: 66px;
        }

        .mw-hill {
          position: absolute;
          bottom: 0;
          border-radius: 50% 50% 0 0;
          background: linear-gradient(
            180deg,
            rgba(33, 121, 77, 0.37),
            rgba(25, 91, 62, 0.56)
          );
        }

        .mw-hill-one {
          width: 420px;
          height: 98px;
          left: -70px;
          transform: skewX(-9deg);
        }

        .mw-hill-two {
          width: 470px;
          height: 82px;
          right: -86px;
          opacity: 0.77;
          transform: skewX(10deg);
        }

        .mw-city {
          position: absolute;
          bottom: 6px;
          width: 25px;
          border-radius: 3px 3px 0 0;
          background: rgba(61, 105, 82, 0.47);
          box-shadow:
            35px 5px 0 rgba(60, 105, 82, 0.36),
            67px -8px 0 rgba(60, 105, 82, 0.43),
            96px 0 0 rgba(60, 105, 82, 0.33),
            133px -13px 0 rgba(60, 105, 82, 0.4);
        }

        .mw-city-a {
          height: 38px;
          left: 16%;
        }

        .mw-city-b {
          height: 51px;
          left: 48%;
          transform: scale(0.75);
          opacity: 0.62;
        }

        .mw-city-c {
          height: 42px;
          right: 19%;
          transform: scale(0.82);
          opacity: 0.7;
        }

        .mw-road-perspective {
          top: auto;
          bottom: -28px;
          height: 145px;
          transform: rotateX(62deg);
          transform-origin: bottom center;
        }

        .mw-road-surface {
          position: absolute;
          inset: 0 7%;
          overflow: hidden;
          background:
            linear-gradient(
              90deg,
              rgba(235, 239, 236, 0.8) 0 5%,
              #617069 5% 95%,
              rgba(235, 239, 236, 0.8) 95% 100%
            );
          box-shadow:
            inset 14px 0 0 rgba(255, 255, 255, 0.07),
            inset -14px 0 0 rgba(255, 255, 255, 0.07);
        }

        .mw-road-center-lines {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 18px;
          transform: translateX(-50%);
          overflow: hidden;
        }

        .mw-road-center-lines span {
          position: absolute;
          left: 3px;
          width: 12px;
          height: 38px;
          border-radius: 3px;
          background: rgba(255, 244, 180, 0.86);
          animation: mwRoadDashMove 1.15s linear infinite;
        }

        .mw-road-center-lines span:nth-child(1) { top: -54px; }
        .mw-road-center-lines span:nth-child(2) { top: -4px; }
        .mw-road-center-lines span:nth-child(3) { top: 46px; }
        .mw-road-center-lines span:nth-child(4) { top: 96px; }
        .mw-road-center-lines span:nth-child(5) { top: 146px; }
        .mw-road-center-lines span:nth-child(6) { top: 196px; }

        .mw-truck-shadow {
          position: absolute;
          z-index: 4;
          width: 250px;
          height: 28px;
          left: 50%;
          bottom: 46px;
          border-radius: 50%;
          background: rgba(15, 40, 27, 0.25);
          filter: blur(9px);
          transform: translateX(-50%) scaleX(1.05);
          animation: mwShadowPulse 0.66s ease-in-out infinite alternate;
        }

        .mw-truck-driver {
          position: absolute;
          z-index: 5;
          width: 300px;
          height: 155px;
          left: 50%;
          bottom: 49px;
          transform: translateX(-50%);
          transform-style: preserve-3d;
          animation:
            mwTruckBob 0.64s ease-in-out infinite alternate,
            mwTruckDrift 4.5s ease-in-out infinite alternate;
        }

        .mw-truck-3d {
          position: relative;
          width: 300px;
          height: 145px;
          transform-style: preserve-3d;
          transform: rotateX(-4deg) rotateY(-9deg);
        }

        .mw-truck-box {
          position: absolute;
          left: 24px;
          top: 23px;
          width: 184px;
          height: 76px;
          transform-style: preserve-3d;
        }

        .mw-truck-box-side {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          overflow: hidden;
          border: 2px solid #e7eee9;
          border-radius: 8px 4px 5px 8px;
          background:
            linear-gradient(
              105deg,
              #f8fbf9 0%,
              #e6ece8 50%,
              #d9e1dc 100%
            );
          box-shadow:
            inset 0 -12px 20px rgba(25, 80, 53, 0.08),
            0 7px 12px rgba(18, 54, 37, 0.13);
          transform: translateZ(24px);
        }

        .mw-truck-box-side::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 6px;
          height: 12px;
          background:
            linear-gradient(
              90deg,
              #0c8a51 0 26%,
              #6fb935 26% 33%,
              #0c8a51 33% 59%,
              #f0c42a 59% 66%,
              #0c8a51 66% 100%
            );
          opacity: 0.95;
        }

        .mw-truck-box-side img {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          object-fit: contain;
          background: #fff;
          flex: 0 0 auto;
        }

        .mw-truck-box-side span {
          position: relative;
          z-index: 2;
          color: #087347;
          font-size: 18px;
          font-weight: 950;
          letter-spacing: 0.03em;
        }

        .mw-truck-box-top {
          position: absolute;
          left: 8px;
          right: 2px;
          top: -21px;
          height: 28px;
          border-radius: 7px 7px 2px 2px;
          background:
            repeating-linear-gradient(
              90deg,
              #cfd8d2 0 14px,
              #aebbb3 14px 18px
            );
          transform:
            rotateX(74deg)
            translateZ(38px)
            translateY(-4px);
          transform-origin: bottom center;
          box-shadow: inset 0 0 0 1px #bbc6bf;
        }

        .mw-truck-box-back {
          position: absolute;
          left: -15px;
          top: 8px;
          width: 26px;
          height: 64px;
          border-radius: 5px 0 0 5px;
          background: linear-gradient(180deg, #198e58, #07673e);
          transform:
            rotateY(77deg)
            translateZ(13px);
          transform-origin: right center;
        }

        .mw-truck-cab {
          position: absolute;
          left: 204px;
          top: 49px;
          width: 70px;
          height: 58px;
          transform-style: preserve-3d;
        }

        .mw-cab-side {
          position: absolute;
          inset: 0;
          overflow: hidden;
          border-radius: 7px 10px 6px 4px;
          background: linear-gradient(
            150deg,
            #f7faf8 0%,
            #e6ebe8 58%,
            #d0d9d3 100%
          );
          border: 1px solid #c4cec8;
          transform: translateZ(23px);
          box-shadow: 0 7px 12px rgba(20, 56, 38, 0.12);
        }

        .mw-cab-window {
          position: absolute;
          right: 9px;
          top: 8px;
          width: 31px;
          height: 21px;
          border-radius: 4px 6px 3px 3px;
          background:
            linear-gradient(
              145deg,
              rgba(177, 226, 233, 0.92),
              rgba(87, 134, 145, 0.93)
            );
          box-shadow: inset 0 0 0 2px rgba(46, 72, 75, 0.18);
        }

        .mw-cab-door-line {
          position: absolute;
          right: 5px;
          top: 34px;
          width: 39px;
          height: 1px;
          background: rgba(75, 92, 84, 0.38);
        }

        .mw-cab-handle {
          position: absolute;
          right: 11px;
          top: 39px;
          width: 9px;
          height: 2px;
          border-radius: 999px;
          background: #6f7c75;
        }

        .mw-cab-front {
          position: absolute;
          right: -17px;
          top: 6px;
          width: 27px;
          height: 50px;
          border-radius: 0 8px 6px 0;
          background: linear-gradient(180deg, #e9efeb, #cbd4cf);
          transform: rotateY(-73deg) translateZ(9px);
          transform-origin: left center;
        }

        .mw-windshield {
          position: absolute;
          left: 5px;
          top: 5px;
          width: 17px;
          height: 21px;
          border-radius: 3px;
          background: linear-gradient(145deg, #b6dce3, #628a95);
        }

        .mw-headlight {
          position: absolute;
          right: 2px;
          width: 7px;
          height: 5px;
          border-radius: 50%;
          background: #fff4a7;
          box-shadow:
            0 0 8px rgba(255, 242, 148, 0.84),
            0 0 16px rgba(255, 235, 114, 0.3);
        }

        .mw-headlight-top { top: 32px; }
        .mw-headlight-bottom { top: 42px; }

        .mw-cab-roof {
          position: absolute;
          left: 2px;
          right: 4px;
          top: -14px;
          height: 21px;
          border-radius: 7px 8px 2px 2px;
          background: #edf2ef;
          border: 1px solid #c8d2cc;
          transform:
            rotateX(73deg)
            translateZ(28px);
          transform-origin: bottom center;
        }

        .mw-truck-chassis {
          position: absolute;
          left: 22px;
          top: 99px;
          width: 257px;
          height: 12px;
          border-radius: 6px;
          background: linear-gradient(180deg, #273730, #15241e);
          transform: translateZ(14px);
          box-shadow: 0 6px 8px rgba(15, 40, 27, 0.23);
        }

        .mw-wheel {
          position: absolute;
          top: 91px;
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 8px solid #19231f;
          background:
            radial-gradient(
              circle at center,
              #aeb9b3 0 28%,
              #5f7067 29% 45%,
              #27332d 46% 100%
            );
          box-shadow:
            inset 0 0 0 2px #0d1512,
            0 6px 8px rgba(13, 28, 20, 0.23);
          transform: translateZ(29px);
          animation: mwWheelSpin 0.72s linear infinite;
        }

        .mw-wheel::before,
        .mw-wheel::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 50%;
          width: 4px;
          height: 23px;
          border-radius: 3px;
          background: rgba(235, 239, 236, 0.72);
          transform: translate(-50%, -50%);
        }

        .mw-wheel::after {
          transform: translate(-50%, -50%) rotate(90deg);
        }

        .mw-wheel-back { left: 52px; }
        .mw-wheel-middle { left: 163px; }
        .mw-wheel-front { left: 232px; }

        .mw-wheel-rim {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #edf2ef;
          transform: translate(-50%, -50%);
          box-shadow: 0 0 0 2px #77877e;
        }

        .mw-loader-copy {
          margin-top: 7px;
          text-align: center;
        }

        .mw-loader-copy h1 {
          margin: 0;
          color: #102238;
          font-size: clamp(24px, 3vw, 31px);
          line-height: 1.15;
          letter-spacing: -0.035em;
          font-weight: 900;
        }

        .mw-loader-copy p {
          max-width: 560px;
          margin: 8px auto 0;
          color: #63758a;
          font-size: 13px;
          line-height: 1.5;
        }

        .mw-loader-progress {
          width: min(100%, 280px);
          height: 7px;
          margin-top: 20px;
          overflow: hidden;
          border-radius: 999px;
          background: #d9e7df;
        }

        .mw-loader-progress span {
          display: block;
          width: 38%;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #10a766, #087d4b);
          box-shadow: 0 0 10px rgba(16, 167, 102, 0.28);
          animation: mwLoaderSweep 1.35s ease-in-out infinite;
        }

        .mw-loader-status {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin-top: 14px;
          color: #466051;
          font-size: 11px;
          font-weight: 750;
        }

        .mw-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10a766;
          box-shadow: 0 0 0 0 rgba(16, 167, 102, 0.4);
          animation: mwStatusPulse 1.45s ease-in-out infinite;
        }

        @keyframes mwWheelSpin {
          from {
            transform: translateZ(29px) rotate(0deg);
          }
          to {
            transform: translateZ(29px) rotate(360deg);
          }
        }

        @keyframes mwTruckBob {
          from {
            transform: translateX(-50%) translateY(0);
          }
          to {
            transform: translateX(-50%) translateY(-3px);
          }
        }

        @keyframes mwTruckDrift {
          0% { margin-left: -26px; }
          100% { margin-left: 26px; }
        }

        @keyframes mwShadowPulse {
          from {
            opacity: 0.22;
            transform: translateX(-50%) scaleX(0.98);
          }
          to {
            opacity: 0.3;
            transform: translateX(-50%) scaleX(1.08);
          }
        }

        @keyframes mwRoadDashMove {
          from {
            transform: translateY(-52px) scaleY(0.65);
          }
          to {
            transform: translateY(58px) scaleY(1.2);
          }
        }

        @keyframes mwLoaderSweep {
          0% { transform: translateX(-125%); }
          100% { transform: translateX(355%); }
        }

        @keyframes mwStatusPulse {
          0% {
            box-shadow: 0 0 0 0 rgba(16, 167, 102, 0.4);
          }
          70% {
            box-shadow: 0 0 0 9px rgba(16, 167, 102, 0);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(16, 167, 102, 0);
          }
        }

        @keyframes mwCloudFloatA {
          from { transform: translateX(-12px); }
          to { transform: translateX(24px); }
        }

        @keyframes mwCloudFloatB {
          from { transform: translateX(15px); }
          to { transform: translateX(-20px); }
        }

        .mw-loader-page.compact .mw-loader-shell {
          width: min(100%, 620px);
        }

        .mw-loader-page.compact .mw-truck-scene {
          height: 235px;
        }

        @media (max-width: 680px) {
          .mw-loader-page {
            padding: 15px;
          }

          .mw-loader-shell {
            padding: 21px 14px 24px;
            border-radius: 20px;
          }

          .mw-loader-brand img {
            width: 47px;
            height: 47px;
            flex-basis: 47px;
          }

          .mw-loader-brand strong {
            font-size: 16px;
          }

          .mw-truck-scene {
            height: 230px;
            border-radius: 17px;
          }

          .mw-truck-driver {
            width: 245px;
            transform: translateX(-50%) scale(0.82);
            transform-origin: bottom center;
          }

          .mw-truck-shadow {
            bottom: 42px;
            width: 205px;
          }

          .mw-loader-copy h1 {
            font-size: 24px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .mw-wheel,
          .mw-truck-driver,
          .mw-truck-shadow,
          .mw-road-center-lines span,
          .mw-loader-progress span,
          .mw-status-dot,
          .mw-cloud {
            animation: none !important;
          }
        }
      `}</style>
    </main>
  );
}
