### 서론
1:N 강의 시스템 구현을 위해 RTC가 필요하여 WebRTC를 언리얼엔진에서 사용할 수 있는 방법에 대해 연구해 보았습니다.
실질적으로 WebRTC라고 함은 Web 위에서 RTC(실시간 통신)을 위해 구현되었습니다.
하지만 WebRTC도 코어는 C++로 이루어졌기 때문에 Core API를 사용한다면 RTC를 사용할 수 있었습니다.
힘들었던 점은 이를 이용해서 구현한 사람이 많이 없기때문에 자료 찾기가 힘들었다는 점입니다. 대부분은 직접 Core 소스코드를 분석하면서 진행해야했습니다.

다른분들도 이를 이용하여 개발해야할 때 좋은 레퍼런스가 되길 바라며 제 경험을 공유하고자 합니다.
> Media Server는 kurento media server을 이용하였습니다.

### WebRTC의 구조
![](https://images.velog.io/images/devdynam0507/post/fd79e454-04ac-4c8f-886f-04fd6df8875b/WebRTC-Arch.png)
R&D하면서 중점적으로 본 부분은 Video Engine과 WebRTC C++ API (PeerConnection) 입니다.
## RTP, RTSP, SDP?

### RTP

TCP의 경우 통신 타이밍에 대해 엄격한 요구조건을 가지고 있습니다. 반면에 RTP의 경우 실시간 미디어 스트림에 맞춰 설계된 프로토콜이므로 UDP 기반으로 이루어져 있습니다. 따라서 RTP의 버퍼에는 timestamp가 기록되어있으며 timestamp의 역할은 다양한 데이터 소스로부터 제공되는 미디어를 통합하는데에 이용됩니다.

RTP 패킷 또한 Sequance Number와 timestamp를 가지게 되는데 Sequance Number는 각 패킷마다 고유하며 UDP 수신부에서는 패킷 순서가 정확하게 온건지 알 수 없기때문에 Sequance Number와 timestamp로 패킷을 재정렬 해야합니다.

### RTSP
RTSP의 경우 RTP보다 상위 프로토콜 개념입니다.
멀티 미디어 스트림에 대한 명령과 제어를 제공합니다. 이 또한 UDP, 비연결지향 프로토콜이며 스트림의 Session ID에 대해 구분된다.

### SDP
Session Description Protocol의 약자로 멀티미디어 세션 파라미터를 협상하는 프로토콜 입니다.
# WebRTC Native C++ API

## PeerConnectionFactory
```c++
CreatePeerConnectionFactory(
    rtc::Thread* network_thread,
    rtc::Thread* worker_thread,
    rtc::Thread* signaling_thread,
    rtc::scoped_refptr<AudioDeviceModule> default_adm,
    rtc::scoped_refptr<AudioEncoderFactory> audio_encoder_factory,
    rtc::scoped_refptr<AudioDecoderFactory> audio_decoder_factory,
    std::unique_ptr<VideoEncoderFactory> video_encoder_factory,
    std::unique_ptr<VideoDecoderFactory> video_decoder_factory,
    rtc::scoped_refptr<AudioMixer> audio_mixer,
    rtc::scoped_refptr<AudioProcessing> audio_processing,
    AudioFrameProcessor* audio_frame_processor = nullptr);
}  // namespace webrtc
```
실제 WebRTC PeerConnection을 생성하기 위한 Factory 함수입니다.

보시면 많은 인자값이 있는데 중점적으로 봐야할 인자값에 대해 설명하겠습니다.
### Threading Models

WebRTC 작업은 2개의 쓰레드에서 처리합니다.

2번째 인자값인 worker thread는 데이터 스트리밍과 같은 리소스 집약적인 프로세스를 처리하는데 사용됩니다.

3번째 인자값인 signaling thread는 PeerConnection API 에 대한 처리가 이루어 집니다.

따라서 모든 Observer 콜백은 signaling thread에서 이루어지게됩니다.

### Audio Device Module (adm)

현재 기종(PC, Mobile)에서 오디오 장치에 대한 정보가 들어있는 클래스이고, 제어도 할 수 있습니다.

실제 Initialize되는 부분은 PeerConnectionFactory가 생성될 때 VoiceEngine의 Init() 함수가 호출되면서 Initialize 됩니다.

4번째 인자인 default_adm에 nullptr을 넘겨주면 각 OS의 기본 adm 을 생성합니다.

각별히 주의해야할 점이 있는데 Voice Engine 소스코드에는 adm()이라는 함수가 있습니다. **(webrtc 내부 소스코드)**

이 함수는 현재 멤버변수로 있는 adm (PeerConnectionfactory에서 넘겨준 default_adm)이 nullptr인지 체크하는 함수인데 실제 VoiceEngine::Init()에서 RTC_CHECK(adm())을 호출하여 null인지 확인합니다.

이걸 체크하기전에 Factory에서 넘어온 default_adm이 null이면 OS의 기본 adm을 생성하는데

이 또한 마땅한 adm이 없다면 nullptr을 반환하기 때문에 이런 경우에는 adm을 따로 커스터마이징 해서 넘겨주는 작업이 필요합니다.

만약 여기서 RTC_CHECK에 실패한다면 크래쉬 내고 강제 종료시켜버립니다.

결론적으로 adm이 nullptr일 때 실패합니다.

### Encoder, Decoder Factory

사용할 코덱의 정보를 정의하고 코덱의 Encoder, Decoder 구현체를 반환해주는 인터페이스입니다.

이 부분또한 중요한 이유는 WebRTC Native API에서 Offer SDP를 만들 때 m= 라인을 이 구현체에 기반하여 미디어 정보를 생성하는데요.

여기서 정의된 코덱 정보에 따라 sdp의 media 정보가 만들어지게 됩니다.

저희 회사 product의 경우 일반 P2P 방식이 아닌 SFU 방식으로 중앙 미디어 서버를 거쳐 통신하기 때문에 Media Server에서 지원해주는 코덱에 맞춰 개발해야합니다.

즉 이 부분또한 커스터마이징 하여 넘겨주어야 합니다.
### CreateBuiltinAudioEncoderFactory(), CreateBuiltinAudioDecoderFactory()
```cpp
rtc::scoped_refptr<AudioEncoderFactory> CreateBuiltinAudioEncoderFactory() {
  return CreateAudioEncoderFactory<
#if WEBRTC_USE_BUILTIN_OPUS
      AudioEncoderOpus,
#endif
#if WEBRTC_USE_BUILTIN_ISAC_FIX
      AudioEncoderIsacFix,
#elif WEBRTC_USE_BUILTIN_ISAC_FLOAT
      AudioEncoderIsacFloat,
#endif
#if WEBRTC_USE_BUILTIN_G722
      AudioEncoderG722,
#endif
#if WEBRTC_USE_BUILTIN_ILBC
      AudioEncoderIlbc,
#endif
      AudioEncoderG711, NotAdvertised<AudioEncoderL16>>();
}
```
Audio Encoder Factory의 경우 Builtin Audio Encoder Factory를 사용해주면 저희 kurento media server에서 지원하는 왠만한 audio codec을 사용할 수 있습니다.
### PeerConnectionFactoryInterface::Options

이 부분은 PeerConnection의 옵션을 설정해주는 클래스입니다.

사실 이 부분에서 건드릴건 크게 없는데요. 제가 개발하면서 실수한 부분이 있어 기록해놓으려고 합니다.

이 클래스의 코드는 [이 링크](https://webrtc.googlesource.com/src/+/refs/heads/main/api/peer_connection_interface.h#1457) 에 있고 1457번 라인에 있습니다.

여기서 1467 라인에 disable_encryption은 건들지 않아도 됩니다.

이 옵션을 true로 바꿔줄 시 SRTP 통신을 적용하지 않겠다는 옵션이라 false로 그대로 놔둬야 합니다.

### VideoEncoderFactory, VideoDecoderFactory

WebRTC에는 기본적으로 VP8, VP9, H264 코덱이 내장되어있습니다.

그리고 kurento media server 또한 해당 코덱들을 지원하기때문에 따로 저희가 위 세개의 코덱만 사용하는 VideoDecoderFactory를 구현하였습니다.
### 구현한 VideoCodecFactory.h
```cpp
class VideoDecoderFactory : public webrtc::VideoDecoderFactory
{
public:
	VideoDecoderFactory() : InternalDecoderFactory_(new webrtc::InternalDecoderFactory) {}
	virtual ~VideoDecoderFactory() override;
	
	virtual std::vector<webrtc::SdpVideoFormat> GetSupportedFormats() const override;
	virtual std::unique_ptr<webrtc::VideoDecoder> CreateVideoDecoder(const webrtc::SdpVideoFormat& format) override;

private:
	std::unique_ptr<VideoDecoderFactory> InternalDecoderFactory_;
};
```
### VideoCodecFactory.cpp
```cpp
std::vector<webrtc::SdpVideoFormat> VideoDecoderFactory::GetSupportedFormats() const
{
	std::vector<webrtc::SdpVideoFormat> VideoFormats;

	VideoFormats.push_back(webrtc::SdpVideoFormat(cricket::kVp8CodecName));
	VideoFormats.push_back(webrtc::CreateH264Format(webrtc::H264::kProfileBaseline, webrtc::H264::kLevel3_1, "1"));
	VideoFormats.push_back(webrtc::CreateH264Format(webrtc::H264::kProfileBaseline, webrtc::H264::kLevel3_1, "0"));
	VideoFormats.push_back(webrtc::CreateH264Format(webrtc::H264::kProfileConstrainedBaseline, webrtc::H264::kLevel3_1, "1"));
	VideoFormats.push_back(webrtc::CreateH264Format(webrtc::H264::kProfileConstrainedBaseline, webrtc::H264::kLevel3_1, "0"));
	VideoFormats.push_back(webrtc::SdpVideoFormat(cricket::kAv1CodecName));
	VideoFormats.push_back(webrtc::SdpVideoFormat(cricket::kVp9CodecName));
	
	return VideoFormats;
}

std::unique_ptr<webrtc::VideoDecoder> VideoDecoderFactory::CreateVideoDecoder(const webrtc::SdpVideoFormat& format)
{
	if(format.name == "H264")
	{
		return webrtc::H264Decoder::Create();
	}
	if(format.name == "VP8")
	{
		return webrtc::VP8Decoder::Create();
	}
	if(format.name == "VP9")
	{
		return webrtc::VP9Decoder::Create();
	}
	
	return nullptr;
}

std::unique_ptr<CodeStoryVideoDecoderFactory> CreateVideoDecoderFactory()
{
	return std::make_unique<VideoDecoderFactory>();
}
```
GetSupportedFormats() 함수의 경우 처음에 PeerConnectionFactoryInterface를 생성할 때 호출이 되어 사용할 코덱의 정보를 얻어옵니다.

CreateVideoDecoder의 경우 Answer SDP 응답이 온 이후 SetRemoteDescription()이 호출 된 이후 시그널링 과정에서 mLineIndex 값을 파싱하여 얻어온 Media Codec 정보를 얻어올 때 호출이 되고 Media Codec정보에 따라 분기를 타서 알맞은 Decoder를 반환 해줍니다.

디코더의 경우 아래 헤더에 있습니다.
```cpp
#include "modules/video_coding/codecs/h264/include/h264.h"
#include "modules/video_coding/codecs/vp8/include/vp8.h"
#include "modules/video_coding/codecs/vp9/include/vp9.h"
```
### 위 내용을 종합하여 PeerConnectionFactoryInterface 생성하기
```cpp
 	CodeStoryWebRTCThread::SIGNALING_THREAD->Start();
	CodeStoryWebRTCThread::WORKER_THREAD->Start();

	// Create the PeerConnectionFactory
	rtc::scoped_refptr<webrtc::PeerConnectionFactoryInterface> PeerConnectionFactory = webrtc::CreatePeerConnectionFactory(
	nullptr,
	CodeStoryWebRTCThread::WORKER_THREAD.get(),
	CodeStoryWebRTCThread::SIGNALING_THREAD.get(),
	rtc::scoped_refptr<FAudioCapturer>(new FAudioCapturer),
	webrtc::CreateBuiltinAudioEncoderFactory(), 
	webrtc::CreateBuiltinAudioDecoderFactory(),
	CreateVideoEncoderFactory(),
	CreateVideoDecoderFactory(),
	nullptr,
	SetupAudioProcessingModule()
	);

	webrtc::PeerConnectionFactoryInterface::Options option;
	option.disable_encryption = false; // 없어도 됩니다!
	PeerConnectionFactory->SetOptions(option);
```
시그널링 쓰레드와 워커 쓰레드를 실행하고 인자에 맞게 넣어줍니다.
# PeerConnection과 PeerConnectionObserver

PeerConnectionFactoryInterface에서 PeerConnection을 생성할 수 있는데요.

PeerConnection을 생성하기 위해서는 **webrtc::PeerConnectionInterface::RTCConfiguration Conf객체와, webrtc::PeerConnectionObserver 구현체**가 필요합니다.

### PeerConnectionInterface::RTCConfiguration
```cpp
	webrtc::PeerConnectionInterface::RTCConfiguration Config;
	Config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
	Config.enable_dtls_srtp = true;
```
sdp_semantics의 경우 두가지가 있는데요 SdpSemantics::kPlanB 의 경우 Deprecated 되어있어서 그냥 사용하지 않아도 됩니다.

그래서 Default값으로 kUnifiedPlan이 sdp_semantics에 박혀있기 때문에 저 부분은 따로 설정하지 않아도 자동으로 kUnifiedPlan으로 들어가게 됩니다.

아래 enable_dtls_srtp 또한 절대 false로 바꾸지 말라고 명시되어 있으니 enable_dtls_srtp에는 true를 넣어주시면 됩니다.
### STUN 서버 정의
```cpp
	webrtc::PeerConnectionInterface::IceServer GoogleStun;
	GoogleStun.uri = "stun:stun.l.google.com:19302";
	webrtc::PeerConnectionInterface::IceServer StunProtocol;
	StunProtocol.uri = "stun:stun.stunprotocol.org:3478";
	Config.servers.push_back(GoogleStun);
	Config.servers.push_back(StunProtocol);
```
RTCConfiguration에는 IceServer또한 정의할 수 있는데요. 

저희가 NAT뒤에 있는 경우 STUN, TURN 서버를 통해 공인아이피, 포트번호를 얻어와야합니다.

따라서 범용적으로 사용되는 STUN 서버를 위와같이 정의하여 넣어줍니다.
stun 서버 리스트 입니다. -> [링크](https://gist.github.com/mondain/b0ec1cf5f60ae726202e)
## PeerConnection 생성하기
```cpp
	webrtc::PeerConnectionInterface::RTCConfiguration Config;
	Config.sdp_semantics = webrtc::SdpSemantics::kUnifiedPlan;
	Config.enable_dtls_srtp = true;

	webrtc::PeerConnectionInterface::IceServer GoogleStun;
	GoogleStun.uri = "stun:stun.l.google.com:19302";
	webrtc::PeerConnectionInterface::IceServer StunProtocol;
	StunProtocol.uri = "stun:stun.stunprotocol.org:3478";
	Config.servers.push_back(GoogleStun);
	Config.servers.push_back(StunProtocol);
	
	PeerConnection = PeerConnectionFactory -> CreatePeerConnection(
		Config, nullptr, nullptr, this // 이건 PeerConnectionObserve를 넣어주면 됩니다!
	);
```
CreatePeerConnection() 에서 4번째 인자에서 this가 보이실겁니다.
이는 PeerConnectionObserver의 구현체를 넣어주시면 됩니다.
PeerConnectionObserver는 아래에서 설명드리겠습니다.
### PeerConnectionObserver
아까 위에서 언급했듯이 WebRTC에는 기본적인 쓰레드 모델이 있습니다.
PeerConnection을 생성하고 로직을 타게되면 이제 Signaling Thread에서 동작을 하게 되는데요.
로직을 타면서 PeerConnectionObserver를 호출하게 됩니다.
따라서 저희가 PeerConnectionObserver를 구현해야합니다.
```cpp
	virtual void OnAddStream(rtc::scoped_refptr<webrtc::MediaStreamInterface> stream) override;
	// 시그널링이 트랜시버가 수신 할것임을 나타낼 때 호출된다. Remote Endpoint의 미디어이다. 이것은 SetRemoteDescription()이 호출될 때 trigger 된다.
	virtual void OnAddTrack(rtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver, const std::vector<rtc::scoped_refptr<webrtc::MediaStreamInterface>>& streams) override;
	virtual void OnIceCandidate(const webrtc::IceCandidateInterface* candidate) override;

	// Start unused callbacks //
	virtual void OnSignalingChange(webrtc::PeerConnectionInterface::SignalingState new_state) override;
	virtual void OnRenegotiationNeeded() override;
	virtual void OnDataChannel(rtc::scoped_refptr<webrtc::DataChannelInterface> data_channel) override;
	virtual void OnIceGatheringChange(webrtc::PeerConnectionInterface::IceGatheringState new_state) override;
	// Finish unused callbacks //

	// CreateOffer(), CreateAnswer()가 호출되었을 때 trigger 된다.
	virtual void OnSuccess(webrtc::SessionDescriptionInterface* desc) override;
	virtual void OnFailure(webrtc::RTCError error) override;
```
위 코드는 PeerConnectionObserver의 인터페이스 코드입니다.
저희가 위 코드를 재정의 하여 사용해야 합니다만,
Unused callbacks 라고 주석쳐져있는 부분은 따로 보지 않을 예정입니다.

핵심적인 함수는 **OnSuccess, OnAddStream, OnAddTrack, OnIceCandidate** 함수 입니다.
![](https://images.velog.io/images/devdynam0507/post/1ca89f3b-1989-4bfe-8222-d66f42c2c073/WebRTCNativeAPIsDocument.png)
위 사진은 PeerConnection의 로직을 그림으로 나타낸 사진입니다.

이 부분은 위 사진으로 설명하는게 더 이해가 빠를것 같아 사진을 첨부하였습니다.

먼저 PeerConnectionFactory가 만들어지고 CreatePeerConnection을 하게 됩니다.

여기까지가 지금까지(Create PeerConnectionFactory, Create PeerConnection)의 과정이었습니다.

### 1. OnSuccess()의 호출 시기?
PeerConnection.CreateOffer 가 호출될 때 성공적으로 Offer SDP가 만들어졌다면 OnSuccess가 호출이 됩니다.
### 1-1. CreateOffer()
```cpp
MyWebRTCThread::WORKER_THREAD->Invoke<void>(RTC_FROM_HERE, [this]()
	{
		int offer_to_receive_video = webrtc::PeerConnectionInterface::RTCOfferAnswerOptions::kOfferToReceiveMediaTrue; // 1로 설정시 receive
		int offer_to_receive_audio = webrtc::PeerConnectionInterface::RTCOfferAnswerOptions::kOfferToReceiveMediaTrue; // 0으로 설정시 send only
		bool voice_activity_detection = false;
		bool ice_restart = true;
		bool use_rtp_mux = true;

		webrtc::RtpTransceiverInit TInit;
		TInit.direction = webrtc::RtpTransceiverDirection::kRecvOnly;
		PeerConnection.get()->AddTransceiver(cricket::MEDIA_TYPE_VIDEO,TInit);
		PeerConnection.get()->AddTransceiver(cricket::MEDIA_TYPE_AUDIO, TInit);
		
		PeerConnection.get()->CreateOffer(this, webrtc::PeerConnectionInterface::RTCOfferAnswerOptions(
			offer_to_receive_video,
			offer_to_receive_audio,
			voice_activity_detection,
			ice_restart,
			use_rtp_mux
		));
```
저희는 이제 연결될 피어와 미디어 협상을 해야하는데요.

일단 저희는 영상 데이터를 Recv만 할것이기 때문에 위와같은 설정을 진행해 줘야합니다.

RtpTransceiver 또한 설정을 진행해줘야하는데요

이 트랜시버의 경우 양방향 스트림을 나타냅니다.

저희는 UE4에서 미디어 스트림을 수신받을 것이기때문에 RtpTranceiverDirection을 kRecvOnly로 설정합니다.

이렇게 하면 비동기로 Offer SDP를 만들고 만드는데에 성공했다면 OnSuccess를 호출 실패했다면 OnFailure를 호출합니다.
### 1-2. OnSuccess()
```cpp
void MyWebRTCClient::OnSuccess(webrtc::SessionDescriptionInterface* desc)
{
	std::string OfferSdp;
	
	desc->ToString(&OfferSdp);
	SetLocalDescription(desc);
	Bridge.Get()->OnSuccessCreatedOffer(OfferSdp);
}
```
실제 OnSuccess의 구현부 입니다.

만들어진 Offer SDP를 문자열로 바꾸어 LocalDescription에 저장하고 저희가 따로 만든 하위 옵저버에 sdp 문자열을 전달합니다.

로직상으로 Offer SDP가 만들어졌으면 Signaling 서버로 offer sdp를 보내는 과정이 필요합니다.
## 2. SetRemoteDescription
저희가 Offer SDP를 보냈다면 시그널링 서버를 거쳐 Answer SDP가 와야겠죠 ?

실제 저희 시그널링 로직상에서 Answer SDP를 받아 처리하는 부분만 보여드리겠습니다.
### 2-1. Signaling 서버에서 받은(WebSocket으로 연결 됨) answer sdp
```cpp
// Signaling OnMessage() 시그널링 서버에서 받은 메세지 처리 부분
if(ResponseType.Equals("accepted"))
{
	FString RemoteSdpAnswer = Response.Get()->GetStringField("sdpAnswer");
	SetAnswerSdp(RemoteSdpAnswer);
}
```
```cpp
void MyWebRTCClient::SetAnswerSdp(const FString& AnswerSdp)
{
	std::string SdpStdString = TCHAR_TO_ANSI(*AnswerSdp);

	webrtc::SessionDescriptionInterface* AnswerSdpInstance = webrtc::CreateSessionDescription(webrtc::SdpTypeToString(webrtc::SdpType::kAnswer), SdpStdString, nullptr);
	CodeStoryPeerSetSessionDescriptionObserver* PeerSetObserver = MyPeerSetSessionDescriptionObserver::CreateObserver();
	PeerConnection->SetRemoteDescription(PeerSetObserver, AnswerSdpInstance);
}
```
Answer SDP를 SessionDescriptionInterface* 로 만들어줘야하는데요
```cpp
webrtc::SessionDescriptionInterface* AnswerSdpInstance = 
			webrtc::CreateSessionDescription(
				webrtc::SdpTypeToString(webrtc::SdpType::kAnswer), SdpStdString, nullptr
	);
```
위와같이 넣어주면 됩니다.

그리고 PeerConnection의 SetRemoteDescription을 호출하여 remote answer sdp를 등록합니다.
## 3. OnAddTrack, OnAddStream 호출

SetRemoteDescription이 호출 되었으면 OnAddStream, OnAddTrack 함수가 호출 됩니다.

근데.. 만약에 SetRemoteDescription에 넣어준 Answer SDP가 잘못되었다면 이 함수들은 호출되지 않습니다.

어떠한 오류 메세지도 띄워주지 않아요. 그래서 브레이크 포인트에서 여기가 호출이 안된다면 Answer SDP가 잘못된것이니 answer sdp를 다시 한번 확인하는 작업이 필요합니다. WebRTC Native API를 이용하여 개발할때는 디버그 로그를 다 찍어놓는것이 좋습니다.

이 이벤트가 호출되는 시점에는 미디어 스트림과 RTPReceiver가 PeerConnection에 만들어져 있는 상황이고 미디어 패킷을 받을 수 있는 상태입니다.

OnAddStream에서 따로 처리해줘야 할건 없고 OnAddTrack에서 처리되는 로직을 보여드리겠습니다.
```cpp
void MyWebRTCClient::OnAddTrack(
	rtc::scoped_refptr<webrtc::RtpReceiverInterface> receiver,
	const std::vector<rtc::scoped_refptr<webrtc::MediaStreamInterface>>& streams
)
{
	const auto Track = receiver->track().get();
	
	if(Track->kind() == "video")
	{
		VideoTrack = static_cast<webrtc::VideoTrackInterface*>(Track);
		VideoTrack -> AddOrUpdateSink(&VideoReceiver.Get(), rtc::VideoSinkWants());
	}
	
	Bridge->OnAddTrack(receiver, streams);
}
```
이 함수는 두번 호출됩니다. 하나는 video track 나머지 한개는 audio track입니다.

인자로는 RtpReceiverInterface가 넘어오는데 이놈은 실제 Rtp Packet을 받는 엔드포인트를 포함하고 있습니다.

저희 방식의 경우 상대방의 Track을 취득하여 저희가 개발한 VideoReceiver에 싱크를 맞춰줍니다.

이렇게 되면 이제 저희는 미디어를 수신할 수 있는 상태가 된것입니다!

**(오디오 트랙의 경우 아직 지원하지 않기 때문에 위 로직에서는 오디오 트랙의 처리는 구현이 되지 않았습니다.)**
## OnIceCandidate
```cpp
void MyWebRTCClient::OnIceCandidate(const webrtc::IceCandidateInterface* candidate)
{
	UE_LOG(LogTemp, Log, TEXT("Called OnIceCandidate()"));
	PeerConnection->AddIceCandidate(candidate);
	std::string CandidateName;

	candidate->ToString(&CandidateName);
	UE_LOG(LogTemp, Log, TEXT("%s"), UTF8_TO_TCHAR(CandidateName.c_str()));

	Bridge->OnIceCandidate(candidate);
}
```
일전에 저희가 PeerConnection을 만들 때 STUN 서버를 정의해 주었죠?

일반적으로 NAT 뒤에 있기 때문에 공인 IP(public ip)를 알 수 있는 방법이 없습니다.

따라서 STUN 서버를 통해 저희가 사용할 수 있는 포트와 공인아이피 주소를 얻어와야하는데요

PeerConnection이 만들어지면서 Ice Candidate의 수집이 같이 이루어지게됩니다.

그래서 수집된 Ice Candidate는 OnIceCandidate의 함수를 통해 들어오게 되는데요.

한번만 호출되는게 아닌 여러번 호출이 됩니다.

수집된 IceCandidate는 저희 PeerConnection에도 추가해줘야하고 Signaling 서버로 보내 원격 피어에게도 알려주어야 합니다.
### 상대방의 IceCandidate 정보를 받기

IceCandidate를 수집하는 이유는 상대방과 네트워크 연결을 하기 위함입니다.
그러므로 Ice Candidate는 상대방의 Ice Candidate 정보도 받아서 추가해줘야 하는데요
```cpp
// Signaling 서버의 메세지를 수신받는 부분
if(ResponseId.Equals("iceCandidate"))
	{
		FString	SdpMid = Response.Get()->GetStringField("sdpMid");
		FString CandidateString = Response.Get()->GetStringField("candidate");
		FString SdpMLineIndex = Response.Get()->GetStringField("sdpMLineIndex");
		webrtc::SdpParseError _SdpParseError;

		std::string ParsedSdpMid = TCHAR_TO_UTF8(*SdpMid);
		std::string ParsedCandidate = TCHAR_TO_UTF8(*CandidateString);
		int32 ParsedMLineIndex = FCString::Atoi(*SdpMLineIndex);
		UE_LOG(LogTemp, Log, TEXT("sdpMLineIndex %d"), ParsedMLineIndex);
		
		webrtc::IceCandidateInterface *Candidate = webrtc::CreateIceCandidate(
			   ParsedSdpMid,
	       ParsedMLineIndex,
	       ParsedCandidate,
				 &_SdpParseError
		 );

		PeerConnection.get()->AddIceCandidate(Candidate);
		return;
	}
```
위 부분은 Signaling 서버와 통신하면서 상대방의 ice candidate를 받는 부분입니다.

먼저 받은 정보를 파싱하여 IceCandidateInterface 객체로 만들어주고 PeerConnection에 추가해주는 부분입니다.

이 로직이 실행되게 되면 ice 정보로 원격 피어와 커넥션을 시도하게 되고 sdpMLineIndex 정보를 얻어와서 Decoder Factory에서 알맞은 Decoder를 찾아옵니다. (VideoDecoderFactory의 CreateVideoDecoder() 함수가 호출 됨)

# VideoReceiver

이제 받은 Video Frame을 저희가 화면에 뿌려줘야 하는데요.
여기서 나오는 개념은 yuv 포맷입니다.

### yuv format?
- YUV format 은 RGB(Red, Green, Blue) 3 원색의 format 과 손실없이 1:1 변환(mapping)
- 빛의 밝기를 나타내는 휘도(Y)와 Chroma Components 로 불리는 2개의 색상 신호(U, V)로 구성한다.
- 인간의 눈이 색상신호보다 밝기 신호에 민감한 눈의 인지 원리를 이용한다.
- 밝기를 담당하는 Y sample 은 모두 취하고, 상대적으로 둔감한 색상을 담당하는 U 나 V sample 은 4 개의 픽셀에서 1 개 또는 2 개의 픽셀만 취급하여 저장할 비디오의 용량을 줄일 수 있다.

이는 이미지 처리 관련 개념이라... 일단 저렇다는것만 알아두겠습니다.

### 어떻게 미디어 패킷을 받을 수 있을까?

rtc::VideoSinkInterface<webrtc::VideoFrame>를 상속받은 구현체가 있으면 됩니다!

위 3번섹션(**OnAddTrack, OnAddStream 호출**) 코드를 잘 보시면 

```cpp
VideoTrack -> AddOrUpdateSink(&VideoReceiver.Get(), rtc::VideoSinkWants());
```

이러한 코드가 있을겁니다. 상대방의 비디오 트랙에 rtc::VideoSinkInterface<webrtc::VideoFrame>을 상속받은 구현체를 넘겨주면 됩니다!
### VideoStreamReceiver.h

```cpp
class WEBRTCPLUGIN_API MyVideoStreamReceiver : public rtc::VideoSinkInterface<webrtc::VideoFrame>
{
public:
	CodeStoryVideoStreamReceiver(TSharedPtr<FMyVideoStreamReceiverInterface> Receiver)
		: Receiver(Receiver)
	{}
	
	virtual void OnFrame(const webrtc::VideoFrame& frame) override;

private:
	TSharedPtr<FMyVideoStreamReceiverInterface> Receiver;
};
```

### VideoStreamReceiver.cpp
```cpp
#include "VideoStreamReceiver.h"

void MyVideoStreamReceiver::OnFrame(const webrtc::VideoFrame& frame)
{
	UE_LOG(LogTemp, Log, TEXT("Received Video Frame id : [%d]"), frame.id());

	const int VideoWidth = frame.width();
	const int VideoHeight = frame.height();

	this->Receiver.Get()->OnFrame(frame.video_frame_buffer()->ToI420(), VideoWidth, VideoHeight);
}
```
이제 비디오 패킷을 수신하게 되면 여기로 옵니다

현재 수신되고있는 frame의 width, height를 구할 수 있고 video_frame_buffer를 이용하여 실제 이미지 데이터를 얻을 수 있습니다.

이제 실제 화면에 뿌려주기 위한 처리를 해보겠습니다.
### I420 to RGBA

```cpp
void WebRTCExample::UpdateFrame(rtc::scoped_refptr<webrtc::I420BufferInterface> FrameBuffer)
{
	VideoWidth = FrameBuffer->width();
	VideoHeight = FrameBuffer->height();
	
	// i420 to RGB 변환 후 UE4 텍스처에 렌더링 해야함
	const webrtc::I420BufferInterface* I420Buf = FrameBuffer->ToI420();
	// 변환될 rgb가 담길 buffer
	// 너비 x 높이 x 4(rgba) 
	uint8_t* Dest = new uint8_t[VideoWidth * VideoHeight * 4];

	// libyuv를 이용하여 yuv420 포맷을 BGRA 형식으로 바꿔준다.
	bool bIsConverted = libyuv::I420ToBGRA(
		I420Buf->DataY(), I420Buf->StrideY(),
		I420Buf->DataU(), I420Buf->StrideU(),
		I420Buf->DataV(), I420Buf->StrideV(),
		Dest, VideoWidth * 4, VideoWidth, VideoHeight
	) > -1;

	// 만약 변환에 성공하였다면
	if(bIsConverted)
	{
		// RGB Array 초기화
		TArray<FColor> Data;
		Data.Init(FColor(0, 0, 0, 255), VideoWidth * VideoHeight);

		// 변환된 RGBA 배열을 TArray로 옮겨준다.
		for(int y = 0; y < FrameBuffer->height(); y++)
		{
			for(int x = 0; x < FrameBuffer->width(); x++)
			{
				const int pos = x + y * static_cast<int>(VideoWidth);

				Data[pos].R = Dest[pos * 4];
				Data[pos].G = Dest[pos * 4 + 1];
				Data[pos].B = Dest[pos * 4 + 2];
				Data[pos].A = Dest[pos * 4 + 3];
			}
		}

		// 현재 OnFrame이 호출되는 쓰레드의 경우 webrtc 자체 쓰레드(worker_thread)
		// 이기 때문에 RenderQueue 넣어놓고 Tick에서 꺼내 쓴다.
		// 이렇게 하지 않을 경우 Thread crash가 뜬다.
		RenderTargetQueue.Enqueue(Data);
	}
	
	delete Dest;
}
```

libyuv 라이브러리를 이용한 i420 to RGBA 소스코드입니다.

libyuv 라이브러리 또한 webrtc에 내장되어있습니다.

```cpp
#include "common_video/libyuv/include/webrtc_libyuv.h"
```

이렇게 되면 실제 I420 포맷에서 RGBA 포맷으로 변환이 되어 언리얼 게임 화면에 송출됨을 확인할 수 있습니다

# 한눈에 보는 WebRTC SFU 연결 방식

### 1. Create Peer Connection
![](https://images.velog.io/images/devdynam0507/post/30132c74-b01e-49a3-a0b2-5541430259ba/peerConnectioncreate.png.png)
### 2. Offer / Answer
![](https://images.velog.io/images/devdynam0507/post/9a5db489-e3d2-4054-8727-37ae515ef1d6/offer_answer.png.png)
### 3. Start Communication
![](https://images.velog.io/images/devdynam0507/post/d2df7676-d1bb-4773-8c63-0f8ef5d4b287/result.png)

### 마무리하며
코드의 일부분만 올려서 설명을 드렸는데 완전한 소스코드를 보고싶다면 
https://github.com/devdynam0507/UE4WebRTCVideoStream
여기서 볼 수 있습니다.

틀린 부분은 댓글로 지적해주세요!

감사합니다.

### 참고자료
[WebRTC Native api 문서](https://webrtc.github.io/webrtc-org/native-code/native-apis/)